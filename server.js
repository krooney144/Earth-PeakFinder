// ============================================================
// server.js — Express backend for Earth PeakFinder
// ============================================================
// Responsibilities:
//   1. Serve the static frontend (public/)
//   2. Proxy Cesium Ion terrain tile requests (keeps token server-side)
//   3. Cache terrain tiles locally for offline use
//   4. Proxy Overpass API requests to avoid CORS issues
// ============================================================

require('dotenv').config()
const express = require('express')
const fs      = require('fs')
const path    = require('path')
const https   = require('https')
const http    = require('http')

const app  = express()
const PORT = process.env.PORT || 3000

const CESIUM_TOKEN = process.env.CESIUM_ION_TOKEN
const CACHE_DIR    = path.join(__dirname, 'terrain-cache')

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

// ---- Static files ----
app.use(express.static(path.join(__dirname, 'public')))

// ---- API: provide Cesium token to frontend ----
app.get('/api/config', (req, res) => {
  res.json({
    cesiumToken: CESIUM_TOKEN || ''
  })
})

// ---- API: proxy Cesium terrain tile requests with caching ----
// URL pattern: /api/terrain/:z/:x/:y
// Fetches quantized-mesh terrain tiles from Cesium World Terrain
app.get('/api/terrain/:z/:x/:y', async (req, res) => {
  const { z, x, y } = req.params
  const cacheKey  = `${z}_${x}_${y}.terrain`
  const cachePath = path.join(CACHE_DIR, cacheKey)

  // Serve from cache if available
  if (fs.existsSync(cachePath)) {
    res.set('Content-Type', 'application/vnd.quantized-mesh')
    res.set('X-Cache', 'HIT')
    return res.send(fs.readFileSync(cachePath))
  }

  // Fetch from Cesium Ion
  try {
    // First get the terrain endpoint URL from Cesium Ion
    const tileData = await fetchCesiumTile(z, x, y)
    // Cache for offline use
    fs.writeFileSync(cachePath, tileData)
    res.set('Content-Type', 'application/vnd.quantized-mesh')
    res.set('X-Cache', 'MISS')
    res.send(tileData)
  } catch (err) {
    console.error(`Terrain fetch error (${z}/${x}/${y}):`, err.message)
    res.status(502).json({ error: 'Failed to fetch terrain tile' })
  }
})

// ---- API: proxy Overpass requests ----
app.get('/api/peaks', async (req, res) => {
  const { lat, lng, radius } = req.query
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng required' })
  }

  const r = radius || 50000 // default 50km radius in metres
  const query = `
    [out:json][timeout:25];
    (
      node["natural"="peak"](around:${r},${lat},${lng});
      node["natural"="volcano"](around:${r},${lat},${lng});
    );
    out body;
  `

  try {
    const data = await httpGet(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
    )
    const json = JSON.parse(data)
    const peaks = (json.elements || [])
      .filter(el => el.tags && el.tags.name)
      .map(el => ({
        name:      el.tags.name,
        lat:       el.lat,
        lng:       el.lon,
        elevation: parseFloat(el.tags.ele) || 0
      }))
    res.json(peaks)
  } catch (err) {
    console.error('Overpass error:', err.message)
    res.status(502).json({ error: 'Failed to fetch peaks from OSM' })
  }
})

// ---- API: elevation lookup via Open-Elevation (fallback / simple) ----
app.get('/api/elevation', async (req, res) => {
  const { lat, lng } = req.query
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng required' })
  }
  try {
    const data = await httpGet(
      `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`
    )
    const json = JSON.parse(data)
    if (json.results && json.results[0]) {
      res.json({ elevation: json.results[0].elevation })
    } else {
      res.json({ elevation: 0 })
    }
  } catch (err) {
    console.error('Elevation API error:', err.message)
    res.status(502).json({ error: 'Failed to fetch elevation' })
  }
})

// ---- API: batch elevation sampling for ray tracing ----
// Accepts POST with JSON body: { points: [{lat, lng}, ...] }
// Returns elevations from Terrarium RGB tiles or Open-Elevation
app.use(express.json({ limit: '5mb' }))

app.post('/api/elevations', async (req, res) => {
  const { points } = req.body
  if (!points || !Array.isArray(points)) {
    return res.status(400).json({ error: 'points array required' })
  }

  // Batch query Open-Elevation (supports up to ~1000 points per request)
  // Split into chunks of 500
  const chunkSize = 500
  const results = []

  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize)
    const locations = chunk.map(p => `${p.lat},${p.lng}`).join('|')

    try {
      const data = await httpGet(
        `https://api.open-elevation.com/api/v1/lookup?locations=${locations}`
      )
      const json = JSON.parse(data)
      if (json.results) {
        results.push(...json.results.map(r => r.elevation))
      }
    } catch (err) {
      // Fill with zeros on failure
      results.push(...new Array(chunk.length).fill(0))
      console.error('Batch elevation error:', err.message)
    }
  }

  res.json({ elevations: results })
})

// ---- Helper: fetch a Cesium terrain tile ----
let cesiumEndpoint = null

async function getCesiumEndpoint() {
  if (cesiumEndpoint) return cesiumEndpoint
  const data = await httpGet(
    `https://api.cesium.com/v1/assets/1/endpoint?access_token=${CESIUM_TOKEN}`
  )
  const json = JSON.parse(data)
  cesiumEndpoint = json
  return json
}

async function fetchCesiumTile(z, x, y) {
  const endpoint = await getCesiumEndpoint()
  const url = `${endpoint.url}/${z}/${x}/${y}.terrain?v=1.2.0`
  return httpGetBuffer(url, {
    'Authorization': `Bearer ${endpoint.accessToken}`
  })
}

// ---- Helper: HTTPS GET returning string ----
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    mod.get(url, { timeout: 30000 }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return httpGet(resp.headers.location).then(resolve).catch(reject)
      }
      if (resp.statusCode !== 200) {
        resp.resume()
        return reject(new Error(`HTTP ${resp.statusCode}`))
      }
      let data = ''
      resp.on('data', chunk => data += chunk)
      resp.on('end', () => resolve(data))
      resp.on('error', reject)
    }).on('error', reject)
  })
}

// ---- Helper: HTTPS GET returning Buffer ----
function httpGetBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const options = { headers, timeout: 30000 }
    mod.get(url, options, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return httpGetBuffer(resp.headers.location, headers).then(resolve).catch(reject)
      }
      if (resp.statusCode !== 200) {
        resp.resume()
        return reject(new Error(`HTTP ${resp.statusCode}`))
      }
      const chunks = []
      resp.on('data', chunk => chunks.push(chunk))
      resp.on('end', () => resolve(Buffer.concat(chunks)))
      resp.on('error', reject)
    }).on('error', reject)
  })
}

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`\n  Earth PeakFinder running at http://localhost:${PORT}\n`)
  if (!CESIUM_TOKEN) {
    console.warn('  ⚠  No CESIUM_ION_TOKEN set — terrain tiles will not load.')
    console.warn('     Copy .env.example to .env and add your token.\n')
  }
})
