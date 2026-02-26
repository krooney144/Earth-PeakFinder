// ============================================================
// terrain.js — Terrain elevation data fetching
// ============================================================
// Provides elevation data for the ray-tracing algorithm.
// Uses the server-side proxy which caches tiles for offline use.
//
// Two strategies:
//   1. Batch API: sends all points to server, server queries
//      Open-Elevation or decodes Terrarium tiles
//   2. Terrarium RGB tiles: decode elevation from RGB-encoded
//      PNG tiles directly in the browser (faster for many points)
// ============================================================

const Terrain = (function () {

  // ---- Terrarium tile decoder ----
  // Terrarium tiles encode elevation as RGB:
  //   elevation = (R * 256 + G + B / 256) - 32768
  // Tiles are 256x256 pixels, served as PNGs

  const TILE_SIZE = 256
  const tileCache = new Map()

  /**
   * lat/lng to tile coordinates at a given zoom level
   */
  function latLngToTile(lat, lng, zoom) {
    const n     = Math.pow(2, zoom)
    const x     = Math.floor((lng + 180) / 360 * n)
    const latR  = lat * Math.PI / 180
    const y     = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n)
    return { x, y, z: zoom }
  }

  /**
   * lat/lng to pixel coordinates within a tile
   */
  function latLngToPixel(lat, lng, zoom) {
    const n    = Math.pow(2, zoom)
    const xF   = (lng + 180) / 360 * n
    const latR = lat * Math.PI / 180
    const yF   = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n

    const tileX = Math.floor(xF)
    const tileY = Math.floor(yF)
    const px    = Math.floor((xF - tileX) * TILE_SIZE)
    const py    = Math.floor((yF - tileY) * TILE_SIZE)

    return { tileX, tileY, px, py }
  }

  /**
   * Load a Terrarium tile and return its pixel data
   */
  function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`
    if (tileCache.has(key)) return tileCache.get(key)

    const promise = new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width  = TILE_SIZE
        canvas.height = TILE_SIZE
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
        resolve(imageData.data)
      }
      img.onerror = () => reject(new Error(`Failed to load tile ${key}`))
      // Use AWS Terrain Tiles (free, no key needed)
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
    })

    tileCache.set(key, promise)
    return promise
  }

  /**
   * Get elevation from a Terrarium tile's pixel data
   */
  function elevationFromPixel(data, px, py) {
    const idx = (py * TILE_SIZE + px) * 4
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    return (r * 256 + g + b / 256) - 32768
  }

  /**
   * getElevationsTerrarium — fetch elevations for an array of {lat, lng} points
   * using Terrarium RGB tiles decoded in the browser.
   *
   * This is the primary elevation strategy — fast, free, works with
   * any number of points, and tiles get cached for offline.
   */
  async function getElevationsTerrarium(points, zoom = 10) {
    // Determine which tiles we need
    const tileMap = new Map()

    points.forEach((pt, i) => {
      const { tileX, tileY, px, py } = latLngToPixel(pt.lat, pt.lng, zoom)
      const key = `${zoom}/${tileX}/${tileY}`
      if (!tileMap.has(key)) {
        tileMap.set(key, { z: zoom, x: tileX, y: tileY, points: [] })
      }
      tileMap.get(key).points.push({ i, px, py })
    })

    // Load all needed tiles in parallel
    const tileEntries = Array.from(tileMap.values())
    const tileDataArr = await Promise.all(
      tileEntries.map(t => loadTile(t.z, t.x, t.y).catch(() => null))
    )

    // Extract elevations
    const elevations = new Array(points.length).fill(0)

    tileEntries.forEach((entry, ti) => {
      const data = tileDataArr[ti]
      if (!data) return
      entry.points.forEach(({ i, px, py }) => {
        const clampPx = Math.min(Math.max(px, 0), TILE_SIZE - 1)
        const clampPy = Math.min(Math.max(py, 0), TILE_SIZE - 1)
        elevations[i] = elevationFromPixel(data, clampPx, clampPy)
      })
    })

    return elevations
  }

  /**
   * getElevationsAPI — fallback: fetch elevations via the server proxy.
   */
  async function getElevationsAPI(points) {
    const resp = await fetch('/api/elevations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points })
    })
    if (!resp.ok) throw new Error(`Elevation API error: ${resp.status}`)
    const data = await resp.json()
    return data.elevations
  }

  /**
   * getViewerElevation — get elevation at a single point
   */
  async function getViewerElevation(lat, lng) {
    try {
      const elevs = await getElevationsTerrarium([{ lat, lng }], 12)
      return elevs[0]
    } catch {
      const resp = await fetch(`/api/elevation?lat=${lat}&lng=${lng}`)
      const data = await resp.json()
      return data.elevation || 0
    }
  }

  return {
    getElevationsTerrarium,
    getElevationsAPI,
    getViewerElevation,
    latLngToTile,
    tileCache
  }

})()
