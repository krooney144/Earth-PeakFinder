// ============================================================
// panorama.js — Core maths engine + sketch-style canvas drawing
// ============================================================
// Renders terrain as a monochrome hand-drawn topographic
// panorama with layered ridges, cross-hatching, and
// atmospheric depth fading.
//
// CONTENTS:
//   1. Constants
//   2. Geographic maths
//   3. Earth curvature correction
//   4. calculateSkyline() — ray-tracing with depth layers
//   5. Sketch helpers (jitter, hatching)
//   6. drawPanorama()     — sketch-style ridge rendering
//   7. drawPeakLabels()   — rotated labels with tick marks
//   8. drawCompassOverlay()
// ============================================================

const Panorama = (function () {

  // ---- 1. Constants ----

  const EARTH_R = 6371

  const SAMPLE_KM = [
    0.3, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 13,
    17, 22, 28, 36, 46, 58, 72, 90, 110, 135, 165, 200, 240, 300
  ]

  const MAX_RANGE_KM = 300

  // Depth bands for layered ridges (km boundaries)
  const DEPTH_BANDS = [
    { min: 0,   max: 5,   label: 'near' },
    { min: 5,   max: 15,  label: 'close' },
    { min: 15,  max: 35,  label: 'mid-near' },
    { min: 35,  max: 65,  label: 'mid' },
    { min: 65,  max: 110, label: 'mid-far' },
    { min: 110, max: 175, label: 'far' },
    { min: 175, max: 250, label: 'distant' },
    { min: 250, max: 400, label: 'horizon' }
  ]

  // Sketch style constants
  const BG_COLOR       = '#f5f0e8'  // warm off-white paper
  const INK_COLOR      = '#1a1a1a'  // near-black ink
  const LABEL_COLOR    = '#2a2a2a'
  const JITTER_AMOUNT  = 1.2        // px of hand-drawn wobble
  const HATCH_SPACING  = 6          // px between hatch lines
  const HATCH_ANGLE    = -35 * Math.PI / 180  // degrees of diagonal hatching

  // ---- 2. Geographic maths ----

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

  function getBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180
    const p1   = lat1 * Math.PI / 180
    const p2   = lat2 * Math.PI / 180
    const y    = Math.sin(dLng) * Math.cos(p2)
    const x    = Math.cos(p1) * Math.sin(p2) -
                 Math.sin(p1) * Math.cos(p2) * Math.cos(dLng)
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
  }

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

  function applyCurvature(elevationM, distKm) {
    const distMiles  = distKm * 0.621371
    const dropMetres = 0.1695 * distMiles * distMiles
    return elevationM - dropMetres
  }

  // ---- 4. Ray-tracing with depth layers ----

  /**
   * calculateSkyline — returns both the overall skyline AND
   * per-depth-band ridge profiles for layered drawing.
   */
  async function calculateSkyline(viewLat, viewLng, viewElevM, numRays, getElevations, onProgress) {
    onProgress('Building sample grid...', 5)

    const allPoints = []
    const meta      = []
    const azStep    = 360 / numRays

    for (let ray = 0; ray < numRays; ray++) {
      const azimuth = ray * azStep
      for (let di = 0; di < SAMPLE_KM.length; di++) {
        const pt = movePoint(viewLat, viewLng, azimuth, SAMPLE_KM[di])
        allPoints.push(pt)
        meta.push({ ray, di })
      }
    }

    onProgress(`Fetching terrain (${allPoints.length} points)...`, 10)

    // Fetch elevations in batches
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

    // Build per-ray, per-sample angle data
    const rayData = []

    for (let ray = 0; ray < numRays; ray++) {
      const samples = []
      for (let di = 0; di < SAMPLE_KM.length; di++) {
        const idx      = ray * SAMPLE_KM.length + di
        const distKm   = SAMPLE_KM[di]
        const rawElev  = elevations[idx] != null ? elevations[idx] : 0
        const corrElev = applyCurvature(rawElev, distKm)
        const angle    = Math.atan2(corrElev - viewElevM, distKm * 1000)
        samples.push({ distKm, rawElev, corrElev, angle })
      }
      rayData.push(samples)
    }

    // Overall skyline (maximum angle per ray)
    const skyline = []
    for (let ray = 0; ray < numRays; ray++) {
      let maxAngle    = -Infinity
      let horizDistKm = 1
      let horizElevM  = viewElevM

      for (const s of rayData[ray]) {
        if (s.angle > maxAngle) {
          maxAngle    = s.angle
          horizDistKm = s.distKm
          horizElevM  = s.rawElev
        }
      }

      skyline.push({
        azimuth: ray * azStep,
        maxAngle,
        horizDistKm,
        horizElevM
      })
    }

    // Per-depth-band ridges: for each band, find the max angle
    // from samples within that distance range
    const ridgeLayers = []

    for (let bi = 0; bi < DEPTH_BANDS.length; bi++) {
      const band  = DEPTH_BANDS[bi]
      const layer = []

      for (let ray = 0; ray < numRays; ray++) {
        let maxAngle = -Infinity
        let bestDist = band.min
        let bestElev = 0

        for (const s of rayData[ray]) {
          if (s.distKm >= band.min && s.distKm < band.max) {
            if (s.angle > maxAngle) {
              maxAngle = s.angle
              bestDist = s.distKm
              bestElev = s.rawElev
            }
          }
        }

        layer.push({
          azimuth:  ray * azStep,
          maxAngle: maxAngle === -Infinity ? null : maxAngle,
          distKm:   bestDist,
          elevM:    bestElev
        })
      }

      ridgeLayers.push({
        band,
        depth: bi / (DEPTH_BANDS.length - 1), // 0=near, 1=far
        data: layer
      })
    }

    onProgress('Rendering...', 95)

    return { skyline, ridgeLayers, numRays }
  }

  // ---- 5. Sketch helpers ----

  // Seeded pseudo-random for deterministic jitter
  let _seed = 42
  function seedRandom(s) { _seed = s }
  function pseudoRandom() {
    _seed = (_seed * 16807 + 0) % 2147483647
    return (_seed - 1) / 2147483646
  }

  /**
   * jitter — add small random offset to simulate hand-drawn imperfection
   */
  function jitter(val, amount) {
    return val + (pseudoRandom() - 0.5) * 2 * amount
  }

  /**
   * drawJitteredPolyline — draw a polyline with hand-drawn wobble
   */
  function drawJitteredPolyline(ctx, points, jitterAmt) {
    if (points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(jitter(points[0].x, jitterAmt), jitter(points[0].y, jitterAmt))
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(jitter(points[i].x, jitterAmt), jitter(points[i].y, jitterAmt))
    }
    ctx.stroke()
  }

  /**
   * drawCrossHatching — fill an area between two polylines with diagonal lines.
   * topLine and bottomY define the region to hatch.
   */
  function drawCrossHatching(ctx, topPoints, bottomY, spacing, angle, opacity) {
    if (topPoints.length < 2) return

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.strokeStyle = INK_COLOR
    ctx.lineWidth   = 0.4

    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    // For each hatch line, sweep diagonally across the area
    const xMin = topPoints[0].x
    const xMax = topPoints[topPoints.length - 1].x
    const yMin = Math.min(...topPoints.map(p => p.y))
    const span = Math.max(xMax - xMin, bottomY - yMin) * 2
    const step = spacing

    for (let d = -span; d < span; d += step) {
      // Hatch line: a diagonal line across the canvas
      const lx1 = xMin + d
      const ly1 = yMin - 20
      const lx2 = lx1 + span * cosA
      const ly2 = ly1 + span * Math.abs(sinA)

      // Clip to the region between topLine and bottomY
      // Simple approach: walk x positions and find intersection
      const segments = []
      let inRegion = false
      let segStart = null

      for (let x = Math.max(0, xMin); x <= xMax; x += 3) {
        // Find top Y at this x via linear interpolation of topPoints
        const topY = interpolateY(topPoints, x)
        if (topY === null) continue

        // Hatch line Y at this x
        const dx = x - lx1
        const hatchY = ly1 + dx * Math.tan(angle)

        if (hatchY > topY && hatchY < bottomY) {
          if (!inRegion) {
            segStart = { x, y: hatchY }
            inRegion = true
          }
        } else {
          if (inRegion) {
            segments.push({ start: segStart, end: { x: x - 3, y: ly1 + (x - 3 - lx1) * Math.tan(angle) } })
            inRegion = false
          }
        }
      }
      if (inRegion && segStart) {
        segments.push({ start: segStart, end: { x: xMax, y: ly1 + (xMax - lx1) * Math.tan(angle) } })
      }

      // Draw clipped hatch segments
      for (const seg of segments) {
        ctx.beginPath()
        ctx.moveTo(jitter(seg.start.x, 0.5), jitter(seg.start.y, 0.5))
        ctx.lineTo(jitter(seg.end.x, 0.5), jitter(seg.end.y, 0.5))
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  /**
   * interpolateY — find Y at a given X along a polyline
   */
  function interpolateY(points, x) {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      if (x >= p1.x && x <= p2.x) {
        const t = (x - p1.x) / (p2.x - p1.x)
        return p1.y + t * (p2.y - p1.y)
      }
    }
    return null
  }

  /**
   * drawContourFragments — short internal contour lines on slopes
   * to add topographic texture
   */
  function drawContourFragments(ctx, topPoints, bottomY, depth, W) {
    ctx.save()
    const opacity  = lerp(0.08, 0.25, 1 - depth)
    ctx.globalAlpha = opacity
    ctx.strokeStyle = INK_COLOR
    ctx.lineWidth   = 0.3

    seedRandom(Math.floor(depth * 1000) + 7)

    // Scatter short horizontal-ish line fragments
    const numFragments = Math.floor(lerp(8, 40, 1 - depth) * (W / 1000))

    for (let f = 0; f < numFragments; f++) {
      const x     = topPoints[0].x + pseudoRandom() * (topPoints[topPoints.length - 1].x - topPoints[0].x)
      const topY  = interpolateY(topPoints, x)
      if (topY === null) continue

      const range = bottomY - topY
      if (range < 10) continue

      const y     = topY + pseudoRandom() * range * 0.7 + range * 0.1
      const len   = 8 + pseudoRandom() * 25
      const slope = (pseudoRandom() - 0.5) * 0.15

      ctx.beginPath()
      ctx.moveTo(jitter(x, 0.8), jitter(y, 0.8))
      ctx.lineTo(jitter(x + len, 0.8), jitter(y + len * slope, 0.8))
      ctx.stroke()
    }

    ctx.restore()
  }

  function lerp(a, b, t) {
    return a + (b - a) * Math.max(0, Math.min(1, t))
  }

  // ---- 6. Draw panorama (sketch style) ----

  function drawPanorama(ctx, W, H, result, options = {}) {
    const { skyline, ridgeLayers } = result
    const centerAz = options.centerAzimuth || 180
    const fov      = options.fov || 360
    const numRays  = skyline.length

    function normAz(az) { return ((az % 360) + 360) % 360 }

    function azToX(az) {
      let delta = normAz(az) - normAz(centerAz - fov / 2)
      if (delta < 0) delta += 360
      if (delta > fov) delta -= 360
      return (delta / fov) * W
    }

    // Vertical scale from overall skyline
    const visibleAngles = []
    const azMin = centerAz - fov / 2
    for (let i = 0; i < numRays; i++) {
      const az = skyline[i].azimuth
      let delta = normAz(az) - normAz(azMin)
      if (delta < 0) delta += 360
      if (delta <= fov) {
        visibleAngles.push(skyline[i].maxAngle)
      }
    }

    const maxA = visibleAngles.length ? Math.max(...visibleAngles) : 0.01
    const minA = visibleAngles.length ? Math.min(...visibleAngles) - 0.005 : -0.01

    // Map angle to Y: higher angle = higher on screen = smaller Y
    // Use 55% of canvas height for terrain, 12% bottom margin for labels
    function angleToY(angle) {
      const norm = (angle - minA) / (maxA - minA + 0.002)
      return H - (norm * H * 0.55 + H * 0.12)
    }

    // ---- Paper background ----
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, W, H)

    // Subtle paper texture (grain)
    seedRandom(1337)
    ctx.fillStyle = INK_COLOR
    for (let i = 0; i < W * H * 0.002; i++) {
      const gx = pseudoRandom() * W
      const gy = pseudoRandom() * H
      ctx.globalAlpha = pseudoRandom() * 0.04
      ctx.fillRect(gx, gy, 1, 1)
    }
    ctx.globalAlpha = 1

    // ---- Horizon line (very subtle) ----
    const horizY = angleToY(0)
    if (horizY > 20 && horizY < H - 20) {
      ctx.save()
      ctx.strokeStyle = INK_COLOR
      ctx.globalAlpha = 0.08
      ctx.lineWidth   = 0.5
      ctx.setLineDash([12, 24])
      ctx.beginPath()
      ctx.moveTo(0, horizY)
      ctx.lineTo(W, horizY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // ---- Draw ridge layers (back to front) ----
    // Farthest layers first, so nearer layers draw on top
    const reversedLayers = [...ridgeLayers].reverse()

    for (const layer of reversedLayers) {
      const depth = layer.depth  // 0=near, 1=far

      // Build points for this layer
      const points = []
      for (let i = 0; i < layer.data.length; i++) {
        const d  = layer.data[i]
        if (d.maxAngle === null) continue
        const az = d.azimuth
        let delta = normAz(az) - normAz(azMin)
        if (delta < 0) delta += 360
        if (delta > fov) continue
        const x = (delta / fov) * W
        const y = angleToY(d.maxAngle)
        points.push({ x, y })
      }

      if (points.length < 3) continue
      points.sort((a, b) => a.x - b.x)

      // Atmospheric depth: far layers lighter and thinner
      const strokeOpacity = lerp(0.9, 0.2, depth)
      const strokeWeight  = lerp(1.8, 0.5, depth)
      const jitterAmt     = lerp(JITTER_AMOUNT, 0.4, depth)

      // Determine bottom Y for this layer's hatching region
      // Near layers: hatch down further. Far layers: thin band only
      const layerMinY = Math.min(...points.map(p => p.y))
      const hatchDepthPx = lerp(H * 0.35, H * 0.05, depth)
      const layerBottomY = Math.min(layerMinY + hatchDepthPx, H - H * 0.10)

      // White fill to occlude layers behind (simulates overlapping ridges)
      // Only for nearer layers
      if (depth < 0.7) {
        ctx.save()
        ctx.fillStyle = BG_COLOR
        ctx.globalAlpha = lerp(0.95, 0.3, depth)
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (const p of points) ctx.lineTo(p.x, p.y)
        ctx.lineTo(points[points.length - 1].x, layerBottomY)
        ctx.lineTo(points[0].x, layerBottomY)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      // Cross-hatching on slopes (lighter for distant ridges)
      if (depth < 0.85) {
        const hatchOpacity = lerp(0.18, 0.03, depth)
        const hatchSpace   = lerp(HATCH_SPACING, HATCH_SPACING * 2.5, depth)
        drawCrossHatching(ctx, points, layerBottomY, hatchSpace, HATCH_ANGLE, hatchOpacity)
      }

      // Contour fragments for texture
      drawContourFragments(ctx, points, layerBottomY, depth, W)

      // Main ridge line
      seedRandom(Math.floor(depth * 10000) + 42)
      ctx.save()
      ctx.strokeStyle = INK_COLOR
      ctx.globalAlpha = strokeOpacity
      ctx.lineWidth   = strokeWeight
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      drawJitteredPolyline(ctx, points, jitterAmt)
      ctx.restore()

      // Second pass: slightly offset line for hand-drawn doubling effect (near layers only)
      if (depth < 0.4) {
        seedRandom(Math.floor(depth * 10000) + 99)
        ctx.save()
        ctx.strokeStyle = INK_COLOR
        ctx.globalAlpha = strokeOpacity * 0.25
        ctx.lineWidth   = strokeWeight * 0.6
        const offsetPoints = points.map(p => ({ x: p.x, y: p.y + 0.8 }))
        drawJitteredPolyline(ctx, offsetPoints, jitterAmt * 1.3)
        ctx.restore()
      }
    }

    // ---- Compass direction marks along the bottom ----
    const compassPts = [
      { label: 'N', az: 0 },   { label: 'NE', az: 45 },
      { label: 'E', az: 90 },  { label: 'SE', az: 135 },
      { label: 'S', az: 180 }, { label: 'SW', az: 225 },
      { label: 'W', az: 270 }, { label: 'NW', az: 315 }
    ]

    ctx.save()
    compassPts.forEach(({ label, az }) => {
      const x = azToX(az)
      if (x < 0 || x > W) return

      // Thin tick at bottom
      ctx.strokeStyle = INK_COLOR
      ctx.globalAlpha = label === 'N' ? 0.6 : 0.25
      ctx.lineWidth   = label === 'N' ? 1.5 : 0.8
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(x, H - (label === 'N' ? 16 : 10))
      ctx.stroke()

      // Label
      ctx.fillStyle   = INK_COLOR
      ctx.globalAlpha = label === 'N' ? 0.7 : 0.35
      ctx.font        = `${label === 'N' ? '600 ' : '300 '}10px "Inter", "Helvetica Neue", sans-serif`
      ctx.textAlign   = 'center'
      ctx.fillText(label, x, H - (label === 'N' ? 19 : 13))
    })
    ctx.restore()

    // ---- Degree scale ticks (every 10 degrees) ----
    ctx.save()
    ctx.strokeStyle = INK_COLOR
    ctx.globalAlpha = 0.1
    ctx.lineWidth   = 0.5
    for (let deg = 0; deg < 360; deg += 10) {
      const x = azToX(deg)
      if (x < 0 || x > W) continue
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(x, H - 4)
      ctx.stroke()
    }
    ctx.restore()

    return { angleToY, azToX }
  }

  // ---- 7. Peak labels (rotated, sketch style) ----

  function drawPeakLabels(ctx, W, H, peaks, result, viewLat, viewLng, angleToY, azToX) {
    const { skyline } = result
    const sorted  = [...peaks].sort((a, b) => b.elevation - a.elevation)
    const claimed = []
    const numRays = skyline.length
    const azStep  = 360 / numRays

    sorted.forEach(peak => {
      const dist = getDistanceKm(viewLat, viewLng, peak.lat, peak.lng)
      if (dist > MAX_RANGE_KM || dist < 0.3) return

      const bearing = getBearing(viewLat, viewLng, peak.lat, peak.lng)
      const x = azToX(bearing)
      if (x < 5 || x > W - 5) return

      const azIdx = Math.round(bearing / azStep) % numRays
      const s = skyline[azIdx]
      if (!s) return

      const skyY = angleToY(s.maxAngle)

      // Label text
      const nameTxt = peak.name
      const infoTxt = `${Math.round(peak.elevation)}m`
      ctx.font = '300 10px "Inter", "Helvetica Neue", sans-serif'
      const textW = ctx.measureText(nameTxt).width

      // Check for overlap (use wider spacing for rotated labels)
      const overlaps = claimed.some(cx => Math.abs(x - cx) < 28)
      if (overlaps) return
      claimed.push(x)

      // Vertical tick line from skyline upward
      const tickTop    = skyY - 50
      const tickBottom = skyY - 3

      if (tickTop < 5) return

      ctx.save()

      // Tick line
      ctx.strokeStyle = INK_COLOR
      ctx.globalAlpha = 0.35
      ctx.lineWidth   = 0.6
      ctx.beginPath()
      ctx.moveTo(x, tickBottom)
      ctx.lineTo(x, tickTop)
      ctx.stroke()

      // Small dot at skyline
      ctx.globalAlpha = 0.5
      ctx.fillStyle   = INK_COLOR
      ctx.beginPath()
      ctx.arc(x, skyY, 1.5, 0, Math.PI * 2)
      ctx.fill()

      // Rotated text label
      ctx.translate(x, tickTop - 4)
      ctx.rotate(-40 * Math.PI / 180)

      // Peak name
      ctx.globalAlpha = 0.7
      ctx.fillStyle   = LABEL_COLOR
      ctx.font        = '500 10px "Inter", "Helvetica Neue", sans-serif'
      ctx.textAlign   = 'left'
      ctx.fillText(nameTxt, 0, 0)

      // Elevation below name
      ctx.globalAlpha = 0.4
      ctx.font        = '300 8.5px "Inter", "Helvetica Neue", sans-serif'
      ctx.fillText(infoTxt, 0, 11)

      ctx.restore()
    })
  }

  // ---- 8. Compass overlay (top-right) ----

  function drawCompassOverlay(ctx, W, H, centerAz) {
    const cx = W - 50
    const cy = 50
    const r  = 28

    ctx.save()

    // Circle
    ctx.strokeStyle = INK_COLOR
    ctx.globalAlpha = 0.2
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()

    // Cardinal ticks
    const dirs = [
      { label: 'N', angle: 0 },
      { label: 'E', angle: 90 },
      { label: 'S', angle: 180 },
      { label: 'W', angle: 270 }
    ]

    dirs.forEach(({ label, angle }) => {
      const rad = (angle - 90) * Math.PI / 180
      const ox  = Math.cos(rad)
      const oy  = Math.sin(rad)

      ctx.strokeStyle = INK_COLOR
      ctx.globalAlpha = label === 'N' ? 0.5 : 0.2
      ctx.lineWidth   = label === 'N' ? 1.2 : 0.6
      ctx.beginPath()
      ctx.moveTo(cx + ox * (r - 5), cy + oy * (r - 5))
      ctx.lineTo(cx + ox * (r + 2), cy + oy * (r + 2))
      ctx.stroke()

      ctx.fillStyle   = INK_COLOR
      ctx.globalAlpha = 0.4
      ctx.font        = `${label === 'N' ? '500' : '300'} 8px "Inter", sans-serif`
      ctx.textAlign   = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, cx + ox * (r + 10), cy + oy * (r + 10))
    })

    // Needle pointing to center azimuth
    const needleRad = (centerAz - 90) * Math.PI / 180
    ctx.strokeStyle = INK_COLOR
    ctx.globalAlpha = 0.45
    ctx.lineWidth   = 1.5
    ctx.lineCap     = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(needleRad) * (r - 8), cy + Math.sin(needleRad) * (r - 8))
    ctx.stroke()

    // Center dot
    ctx.fillStyle   = INK_COLOR
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    ctx.arc(cx, cy, 2, 0, Math.PI * 2)
    ctx.fill()

    // Heading text below compass
    const dirs16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
    const dirName = dirs16[Math.round(centerAz / 22.5) % 16]
    ctx.globalAlpha = 0.35
    ctx.fillStyle   = INK_COLOR
    ctx.font        = '300 9px "Inter", sans-serif'
    ctx.textAlign   = 'center'
    ctx.fillText(`${Math.round(centerAz)}\u00b0 ${dirName}`, cx, cy + r + 20)

    ctx.restore()
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
    drawCompassOverlay,
    SAMPLE_KM,
    MAX_RANGE_KM
  }

})()
