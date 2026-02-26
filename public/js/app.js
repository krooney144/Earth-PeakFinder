// ============================================================
// app.js — Main application logic
// ============================================================
// Wires up the UI: map, inputs, scan button, canvas interactions.
// Orchestrates: set viewpoint → scan terrain → draw panorama.
// ============================================================

;(function () {

  // ---- DOM refs ----
  const canvas      = document.getElementById('panorama-canvas')
  const ctx         = canvas.getContext('2d')
  const welcome     = document.getElementById('welcome')
  const loading     = document.getElementById('loading')
  const loadingMsg  = document.getElementById('loading-msg')
  const loadingBar  = document.getElementById('loading-bar')
  const hud         = document.getElementById('hud')
  const cursorInfo  = document.getElementById('cursor-info')

  const inputLat    = document.getElementById('input-lat')
  const inputLng    = document.getElementById('input-lng')
  const inputElev   = document.getElementById('input-elev')
  const inputRays   = document.getElementById('input-rays')
  const inputRange  = document.getElementById('input-range')
  const inputFov    = document.getElementById('input-fov')
  const inputCenterAz = document.getElementById('input-center-az')

  const btnScan     = document.getElementById('btn-scan')
  const btnGps      = document.getElementById('btn-gps')
  const btnAutoElev = document.getElementById('btn-auto-elev')

  // ---- State ----
  let viewLat     = null
  let viewLng     = null
  let viewElevM   = null
  let skylineData = null
  let peaksData   = []
  let mapMarker   = null
  let scanning    = false

  // ---- Leaflet mini-map ----
  const map = L.map('mini-map', {
    center: [46.85, 8.30],
    zoom: 6,
    zoomControl: true,
    attributionControl: true
  })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OSM'
  }).addTo(map)

  // Click map to set viewpoint
  map.on('click', (e) => {
    setViewpoint(e.latlng.lat, e.latlng.lng)
  })

  // ---- Quick locations ----
  const quickLocations = [
    { name: 'Mt. Pilatus, Switzerland',  lat: 46.9789, lng: 8.2553, elev: 2128 },
    { name: 'Ben Nevis, Scotland',       lat: 56.7969, lng: -5.0036, elev: 1345 },
    { name: 'Mt. Fuji, Japan',           lat: 35.3606, lng: 138.7274, elev: 3776 },
    { name: 'Grand Canyon S. Rim, AZ',   lat: 36.0544, lng: -112.1401, elev: 2100 },
    { name: 'Jungfraujoch, Switzerland', lat: 46.5472, lng: 7.9855, elev: 3454 },
    { name: 'Matterhorn Viewpoint',      lat: 45.9764, lng: 7.6586, elev: 3289 },
  ]

  const quickList = document.getElementById('quick-locations')
  quickLocations.forEach(loc => {
    const btn = document.createElement('button')
    btn.className = 'btn'
    btn.style.fontSize = '12px'
    btn.style.justifyContent = 'flex-start'
    btn.textContent = loc.name
    btn.addEventListener('click', () => {
      setViewpoint(loc.lat, loc.lng, loc.elev)
    })
    quickList.appendChild(btn)
  })

  // ---- Set viewpoint ----

  function setViewpoint(lat, lng, elev) {
    viewLat = parseFloat(lat.toFixed(5))
    viewLng = parseFloat(lng.toFixed(5))

    inputLat.value = viewLat
    inputLng.value = viewLng

    if (elev != null) {
      viewElevM = elev
      inputElev.value = elev
    } else {
      inputElev.value = ''
      inputElev.placeholder = 'loading...'
      Terrain.getViewerElevation(viewLat, viewLng).then(el => {
        viewElevM = Math.round(el)
        inputElev.value = viewElevM
        inputElev.placeholder = 'auto'
      })
    }

    // Update map marker
    if (mapMarker) map.removeLayer(mapMarker)
    mapMarker = L.circleMarker([viewLat, viewLng], {
      radius: 7,
      color: '#84D1DB',
      fillColor: '#84D1DB',
      fillOpacity: 0.6,
      weight: 2
    }).addTo(map)

    map.setView([viewLat, viewLng], Math.max(map.getZoom(), 9))
    btnScan.disabled = false
  }

  // ---- Input listeners ----

  inputLat.addEventListener('change', () => {
    if (inputLat.value && inputLng.value) {
      setViewpoint(parseFloat(inputLat.value), parseFloat(inputLng.value))
    }
  })
  inputLng.addEventListener('change', () => {
    if (inputLat.value && inputLng.value) {
      setViewpoint(parseFloat(inputLat.value), parseFloat(inputLng.value))
    }
  })
  inputElev.addEventListener('change', () => {
    if (inputElev.value) viewElevM = parseFloat(inputElev.value)
  })

  // Range sliders
  inputRays.addEventListener('input', () => {
    document.getElementById('val-rays').textContent = inputRays.value
  })
  inputRange.addEventListener('input', () => {
    document.getElementById('val-range').textContent = inputRange.value + 'km'
  })
  inputFov.addEventListener('input', () => {
    document.getElementById('val-fov').innerHTML = inputFov.value + '&deg;'
    // Show/hide center azimuth based on FOV
    const centerRow = inputCenterAz.closest('.range-row')
    centerRow.style.display = parseInt(inputFov.value) >= 360 ? 'none' : 'flex'
  })
  inputCenterAz.addEventListener('input', () => {
    const az = parseInt(inputCenterAz.value)
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
    const dir = dirs[Math.round(az / 22.5) % 16]
    document.getElementById('val-center-az').innerHTML = az + '&deg; ' + dir
  })

  // Hide center-az when FOV is 360 (initial state)
  inputCenterAz.closest('.range-row').style.display = 'none'

  // Auto-detect elevation
  btnAutoElev.addEventListener('click', async () => {
    if (viewLat == null || viewLng == null) return
    btnAutoElev.textContent = '...'
    const el = await Terrain.getViewerElevation(viewLat, viewLng)
    viewElevM = Math.round(el)
    inputElev.value = viewElevM
    btnAutoElev.textContent = 'Auto-detect'
  })

  // GPS
  btnGps.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocation not available in this browser.')
      return
    }
    btnGps.textContent = 'Locating...'
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setViewpoint(pos.coords.latitude, pos.coords.longitude,
          pos.coords.altitude ? Math.round(pos.coords.altitude) : undefined)
        btnGps.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> GPS'
      },
      (err) => {
        alert('Could not get location: ' + err.message)
        btnGps.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> GPS'
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  })

  // ---- Scan button ----

  btnScan.addEventListener('click', runScan)

  async function runScan() {
    if (scanning) return
    if (viewLat == null || viewLng == null) return

    // Ensure we have elevation
    if (viewElevM == null || isNaN(viewElevM)) {
      viewElevM = await Terrain.getViewerElevation(viewLat, viewLng)
      inputElev.value = Math.round(viewElevM)
    }

    scanning = true
    btnScan.disabled = true
    welcome.classList.add('hidden')
    loading.classList.remove('hidden')

    const numRays  = parseInt(inputRays.value)
    const maxRange = parseInt(inputRange.value)
    const fov      = parseInt(inputFov.value)
    const centerAz = parseInt(inputCenterAz.value)

    function onProgress(msg, pct) {
      loadingMsg.textContent = msg
      loadingBar.style.width = pct + '%'
    }

    try {
      // Filter sample distances by max range
      const filteredSamples = Panorama.SAMPLE_KM.filter(d => d <= maxRange)
      // The module uses its internal SAMPLE_KM; we pass numRays

      // Calculate skyline
      skylineData = await Panorama.calculateSkyline(
        viewLat, viewLng, viewElevM,
        numRays,
        (points) => Terrain.getElevationsTerrarium(points),
        onProgress
      )

      // Fetch peaks
      onProgress('Loading peak names...', 92)
      peaksData = await Peaks.fetchPeaks(viewLat, viewLng, maxRange)

      // Draw
      onProgress('Drawing panorama...', 96)
      drawAll(fov, centerAz)

      // Update HUD
      hud.classList.remove('hidden')
      document.getElementById('hud-pos').textContent =
        `${viewLat.toFixed(4)}, ${viewLng.toFixed(4)}`
      document.getElementById('hud-elev').textContent =
        `${Math.round(viewElevM)}m`
      document.getElementById('hud-rays').textContent = numRays
      document.getElementById('hud-peaks').textContent = peaksData.length

    } catch (err) {
      console.error('Scan failed:', err)
      alert('Scan failed: ' + err.message)
    } finally {
      loading.classList.add('hidden')
      btnScan.disabled = false
      scanning = false
    }
  }

  // ---- Draw everything ----

  let currentAngleToY = null
  let currentAzToX    = null

  function drawAll(fov, centerAz) {
    resizeCanvas()
    const W = canvas.width
    const H = canvas.height

    const { angleToY, azToX } = Panorama.drawPanorama(ctx, W, H, skylineData, {
      fov,
      centerAzimuth: centerAz
    })
    currentAngleToY = angleToY
    currentAzToX    = azToX

    if (peaksData.length > 0) {
      Panorama.drawPeakLabels(ctx, W, H, peaksData, skylineData,
        viewLat, viewLng, angleToY, azToX)
    }
  }

  // ---- Canvas sizing ----

  function resizeCanvas() {
    const area = canvas.parentElement
    const dpr  = window.devicePixelRatio || 1
    canvas.width  = area.clientWidth * dpr
    canvas.height = area.clientHeight * dpr
    ctx.scale(dpr, dpr)
    // Use CSS pixels for drawing
    canvas.style.width  = area.clientWidth + 'px'
    canvas.style.height = area.clientHeight + 'px'
    // Return CSS dimensions
    canvas.width  = area.clientWidth
    canvas.height = area.clientHeight
  }

  window.addEventListener('resize', () => {
    if (skylineData) {
      drawAll(parseInt(inputFov.value), parseInt(inputCenterAz.value))
    }
  })

  // ---- Canvas mouse interaction: show azimuth + elevation on hover ----

  canvas.addEventListener('mousemove', (e) => {
    if (!skylineData || !currentAzToX) return

    const rect = canvas.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top
    const W    = canvas.width
    const H    = canvas.height

    // Find which azimuth this X corresponds to
    const fov      = parseInt(inputFov.value)
    const centerAz = parseInt(inputCenterAz.value)
    const azMin    = centerAz - fov / 2
    const az       = ((azMin + (mx / W) * fov) % 360 + 360) % 360

    // Find nearest skyline ray
    const numRays = skylineData.length
    const azStep  = 360 / numRays
    const idx     = Math.round(az / azStep) % numRays
    const s       = skylineData[idx]

    if (s) {
      const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
      const dir  = dirs[Math.round(az / 22.5) % 16]

      cursorInfo.style.display = 'block'
      cursorInfo.style.left    = (e.clientX - rect.left + 14) + 'px'
      cursorInfo.style.top     = (e.clientY - rect.top - 30) + 'px'
      cursorInfo.textContent   = `${Math.round(az)}\u00b0 ${dir}  |  ${Math.round(s.horizElevM)}m at ${Math.round(s.horizDistKm)}km`
    }
  })

  canvas.addEventListener('mouseleave', () => {
    cursorInfo.style.display = 'none'
  })

  // ---- Re-draw when FOV / center azimuth changes (live update if we have data) ----

  inputFov.addEventListener('change', () => {
    if (skylineData) drawAll(parseInt(inputFov.value), parseInt(inputCenterAz.value))
  })
  inputCenterAz.addEventListener('change', () => {
    if (skylineData) drawAll(parseInt(inputFov.value), parseInt(inputCenterAz.value))
  })

  // ---- Init: invalidate Leaflet size after panel renders ----
  setTimeout(() => map.invalidateSize(), 200)

})()
