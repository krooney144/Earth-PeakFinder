// ============================================================
// panorama.js — Core maths engine + canvas drawing
// ============================================================
// This file contains all the geographic maths and the
// algorithm that turns elevation data into a panorama silhouette.
//
// CONTENTS:
//   1. Constants
//   2. Geographic maths (movePoint, getBearing, getDistanceKm)
//   3. Earth curvature correction
//   4. calculateSkyline() — the main ray-tracing algorithm
//   5. drawPanorama()     — draws the mountain silhouette
//   6. drawPeakLabels()   — draws peak name labels
//   7. drawCompass()      — compass strip with cardinal directions
// ============================================================

const Panorama = (function () {

  // ---- 1. Constants ----

  const EARTH_R = 6371 // Earth radius in km

  // Distance samples along each ray, in kilometres.
  // Dense near the viewer (terrain details matter), sparse far away.
  const SAMPLE_KM = [
    0.3, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 13,
    17, 22, 28, 36, 46, 58, 72, 90, 110, 135, 165, 200, 240, 300
  ]

  const MAX_RANGE_KM = 300

  // ---- 2. Geographic maths ----

  /**
   * movePoint — given a start lat/lng, move `distKm` in direction `bearingDeg`.
   * Uses the spherical law of cosines.
   */
  function movePoint(lat, lng, bearingDeg, distKm) {
    const d       = distKm / EARTH_R
    const bearing = bearingDeg * Math.PI / 180
    const lat1    = lat * Math.PI / 180
    const lng1    = lng * Math.PI / 180

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
    )
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    )

    return {
      lat: lat2 * 180 / Math.PI,
      lng: ((lng2 * 180 / Math.PI) + 540) % 360 - 180
    }
  }

  /**
   * getBearing — compass direction from point A to point B.
   * Returns 0=N, 90=E, 180=S, 270=W
   */
  function getBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180
    const p1   = lat1 * Math.PI / 180
    const p2   = lat2 * Math.PI / 180
    const y    = Math.sin(dLng) * Math.cos(p2)
    const x    = Math.cos(p1) * Math.sin(p2) -
                 Math.sin(p1) * Math.cos(p2) * Math.cos(dLng)
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
  }

  /**
   * getDistanceKm — Haversine distance between two points.
   */
  function getDistanceKm(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2
    return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  // ---- 3. Earth curvature correction ----

  /**
   * applyCurvature — correct for Earth's curvature + atmospheric refraction.
   * Formula from ViewFinder Panoramas (Jonathan de Ferranti):
   *   drop_metres = 0.1695 * distance_miles^2
   * The 0.1695 constant includes a refraction correction.
   */
  function applyCurvature(elevationM, distKm) {
    const distMiles  = distKm * 0.621371
    const dropMetres = 0.1695 * distMiles * distMiles
    return elevationM - dropMetres
  }

  // ---- 4. Main ray-tracing algorithm ----

  /**
   * calculateSkyline
   *
   * For each azimuth direction, cast a ray outward from the viewpoint,
   * sampling terrain at increasing distances. Track the maximum vertical
   * angle — that's the visible horizon (skyline) in that direction.
   *
   * @param {number}   viewLat    - Viewer latitude
   * @param {number}   viewLng    - Viewer longitude
   * @param {number}   viewElevM  - Viewer elevation in metres
   * @param {number}   numRays    - Number of rays (e.g. 720 for 0.5° steps)
   * @param {function} getElevations - async (points[]) => elevations[]
   * @param {function} onProgress    - (message, percent) callback
   * @returns {Promise<Array>} skyline data
   */
  async function calculateSkyline(viewLat, viewLng, viewElevM, numRays, getElevations, onProgress) {
    onProgress('Building sample grid...', 5)

    // Step 1: Build flat list of all sample points
    const allPoints = []
    const meta      = []

    const azStep = 360 / numRays

    for (let ray = 0; ray < numRays; ray++) {
      const azimuth = ray * azStep
      for (let di = 0; di < SAMPLE_KM.length; di++) {
        const pt = movePoint(viewLat, viewLng, azimuth, SAMPLE_KM[di])
        allPoints.push(pt)
        meta.push({ ray, di })
      }
    }

    const totalPoints = allPoints.length
    onProgress(`Fetching terrain (${totalPoints} points)...`, 10)

    // Step 2: Fetch elevations in batches
    const batchSize  = 500
    const elevations = []

    for (let i = 0; i < allPoints.length; i += batchSize) {
      const batch = allPoints.slice(i, i + batchSize)
      const batchElevs = await getElevations(batch)
      elevations.push(...batchElevs)

      const pct = 10 + Math.round(((i + batch.length) / allPoints.length) * 65)
      onProgress(`Fetching terrain... ${Math.round((i + batch.length) / allPoints.length * 100)}%`, pct)
    }

    onProgress('Tracing rays...', 80)

    // Step 3: For each ray, find the maximum visible angle
    const skyline = []

    for (let ray = 0; ray < numRays; ray++) {
      let maxAngle    = -Infinity
      let horizDistKm = 1
      let horizElevM  = viewElevM

      for (let di = 0; di < SAMPLE_KM.length; di++) {
        const idx    = ray * SAMPLE_KM.length + di
        const distKm = SAMPLE_KM[di]
        const rawElev = elevations[idx] != null ? elevations[idx] : 0

        const corrElev = applyCurvature(rawElev, distKm)
        const angle    = Math.atan2(corrElev - viewElevM, distKm * 1000)

        if (angle > maxAngle) {
          maxAngle    = angle
          horizDistKm = distKm
          horizElevM  = rawElev
        }
      }

      skyline.push({
        azimuth:     ray * azStep,
        maxAngle,
        horizDistKm,
        horizElevM
      })
    }

    onProgress('Rendering...', 95)
    return skyline
  }

  // ---- 5. Draw the mountain silhouette ----

  /**
   * drawPanorama — paints the skyline silhouette onto a canvas.
   *
   * Layout: left = centerAz - fov/2, right = centerAz + fov/2.
   * Default is full 360.
   *
   * @returns {object} { angleToY, azToX } mapping functions
   */
  function drawPanorama(ctx, W, H, skyline, options = {}) {
    const centerAz = options.centerAzimuth || 180
    const fov      = options.fov || 360
    const numRays  = skyline.length

    // Azimuth range
    const azMin = centerAz - fov / 2
    const azMax = centerAz + fov / 2

    // Normalise azimuth to [0, 360)
    function normAz(az) { return ((az % 360) + 360) % 360 }

    // azToX: map azimuth to canvas X
    function azToX(az) {
      let delta = normAz(az) - normAz(azMin)
      if (delta < 0) delta += 360
      if (delta > fov) delta -= 360
      return (delta / fov) * W
    }

    // Gather visible skyline points
    const visiblePoints = []
    const azStep = 360 / numRays

    for (let i = 0; i < numRays; i++) {
      const s  = skyline[i]
      const az = s.azimuth
      let delta = normAz(az) - normAz(azMin)
      if (delta < 0) delta += 360
      if (delta <= fov) {
        visiblePoints.push({ ...s, x: (delta / fov) * W })
      }
    }

    // Sort by x position for drawing
    visiblePoints.sort((a, b) => a.x - b.x)

    // Vertical scale
    const angles = visiblePoints.map(s => s.maxAngle)
    const maxA   = angles.length ? Math.max(...angles) : 0.01
    const minA   = angles.length ? Math.min(...angles) - 0.004 : -0.01

    function angleToY(angle) {
      const norm = (angle - minA) / (maxA - minA + 0.002)
      return H - (norm * H * 0.60 + H * 0.08)
    }

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0,    '#030810')
    sky.addColorStop(0.35, '#0a1628')
    sky.addColorStop(0.7,  '#1a3a6b')
    sky.addColorStop(0.9,  '#4a7ab5')
    sky.addColorStop(1,    '#7aa8cc')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)

    // Mountain silhouette
    if (visiblePoints.length > 1) {
      const mtGrad = ctx.createLinearGradient(0, angleToY(maxA), 0, H)
      mtGrad.addColorStop(0,    '#7a8390')
      mtGrad.addColorStop(0.15, '#4a5260')
      mtGrad.addColorStop(0.4,  '#2a3a2a')
      mtGrad.addColorStop(0.75, '#182018')
      mtGrad.addColorStop(1,    '#0c120c')
      ctx.fillStyle = mtGrad

      ctx.beginPath()
      visiblePoints.forEach((s, i) => {
        const y = angleToY(s.maxAngle)
        if (i === 0) ctx.moveTo(s.x, y)
        else         ctx.lineTo(s.x, y)
      })
      ctx.lineTo(W, H)
      ctx.lineTo(0, H)
      ctx.closePath()
      ctx.fill()

      // Subtle ridgeline highlight
      ctx.strokeStyle = 'rgba(180, 200, 220, 0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      visiblePoints.forEach((s, i) => {
        const y = angleToY(s.maxAngle)
        if (i === 0) ctx.moveTo(s.x, y)
        else         ctx.lineTo(s.x, y)
      })
      ctx.stroke()
    }

    // Horizon line
    const horizY = angleToY(0)
    if (horizY > 10 && horizY < H - 10) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth   = 1
      ctx.setLineDash([8, 16])
      ctx.beginPath()
      ctx.moveTo(0, horizY)
      ctx.lineTo(W, horizY)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.font      = '10px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('— horizon', 6, horizY - 4)
      ctx.restore()
    }

    // Compass labels
    const compassPts = [
      { label: 'N', az: 0 },   { label: 'NE', az: 45 },
      { label: 'E', az: 90 },  { label: 'SE', az: 135 },
      { label: 'S', az: 180 }, { label: 'SW', az: 225 },
      { label: 'W', az: 270 }, { label: 'NW', az: 315 }
    ]

    compassPts.forEach(({ label, az }) => {
      const x   = azToX(az)
      if (x < 0 || x > W) return
      const isN = label === 'N'

      ctx.strokeStyle = isN ? 'rgba(255,100,100,0.6)' : 'rgba(255,255,255,0.25)'
      ctx.lineWidth   = isN ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, isN ? 14 : 8)
      ctx.stroke()

      ctx.fillStyle  = isN ? 'rgba(255,100,100,0.8)' : 'rgba(255,255,255,0.45)'
      ctx.font       = `${isN ? 'bold ' : ''}11px sans-serif`
      ctx.textAlign  = 'center'
      ctx.fillText(label, x, H - 7)
    })

    return { angleToY, azToX }
  }

  // ---- 6. Draw peak labels ----

  function drawPeakLabels(ctx, W, H, peaks, skyline, viewLat, viewLng, angleToY, azToX) {
    const sorted  = [...peaks].sort((a, b) => b.elevation - a.elevation)
    const claimed = []
    const numRays = skyline.length
    const azStep  = 360 / numRays

    sorted.forEach(peak => {
      const dist = getDistanceKm(viewLat, viewLng, peak.lat, peak.lng)
      if (dist > MAX_RANGE_KM || dist < 0.3) return

      const bearing = getBearing(viewLat, viewLng, peak.lat, peak.lng)
      const x = azToX(bearing)
      if (x < 0 || x > W) return

      // Find nearest ray
      const azIdx = Math.round(bearing / azStep) % numRays
      const s = skyline[azIdx]
      if (!s) return

      const y = angleToY(s.maxAngle)

      // Measure text
      const nameLine = peak.name
      const infoLine = `${Math.round(peak.elevation)}m \u00b7 ${Math.round(dist)}km`
      ctx.font = 'bold 11px sans-serif'
      const nameW = ctx.measureText(nameLine).width
      ctx.font = '10px sans-serif'
      const infoW = ctx.measureText(infoLine).width

      const boxW = Math.max(nameW, infoW) + 14
      const boxH = 30
      const boxX = x - boxW / 2
      const boxY = y - boxH - 26

      // Skip overlapping labels
      const overlaps = claimed.some(([x1, x2]) => x > x1 - 8 && x < x2 + 8)
      if (overlaps || boxY < 2) return
      claimed.push([boxX, boxX + boxW])

      // Tick line
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth   = 1
      ctx.beginPath()
      ctx.moveTo(x, y - 3)
      ctx.lineTo(x, boxY + boxH)
      ctx.stroke()

      // Gold dot at peak
      ctx.fillStyle = 'rgba(255, 200, 80, 0.9)'
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()

      // Label background
      ctx.fillStyle = 'rgba(8, 16, 32, 0.88)'
      roundRect(ctx, boxX, boxY, boxW, boxH, 5)
      ctx.fill()
      ctx.strokeStyle = 'rgba(132, 209, 219, 0.25)'
      ctx.lineWidth = 0.5
      roundRect(ctx, boxX, boxY, boxW, boxH, 5)
      ctx.stroke()

      // Peak name
      ctx.fillStyle = '#ffffff'
      ctx.font      = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(nameLine, x, boxY + 13)

      // Info line
      ctx.fillStyle = '#93c5fd'
      ctx.font      = '10px sans-serif'
      ctx.fillText(infoLine, x, boxY + 24)
    })
  }

  // ---- Helper: rounded rectangle ----
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  // ---- Public API ----
  return {
    movePoint,
    getBearing,
    getDistanceKm,
    applyCurvature,
    calculateSkyline,
    drawPanorama,
    drawPeakLabels,
    SAMPLE_KM,
    MAX_RANGE_KM
  }

})()
