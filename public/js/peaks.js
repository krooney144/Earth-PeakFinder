// ============================================================
// peaks.js — Peak data from OpenStreetMap via Overpass API
// ============================================================
// Fetches named peaks/volcanoes near a viewpoint from OSM.
// Uses the server-side proxy to avoid CORS restrictions.
// ============================================================

const Peaks = (function () {

  let cachedPeaks  = null
  let cachedCenter = null

  /**
   * fetchPeaks — get named peaks within `radiusKm` of a point.
   * Results are cached so we don't re-query if the viewpoint hasn't moved much.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} radiusKm - search radius in km (default 80)
   * @returns {Promise<Array>} [{name, lat, lng, elevation}, ...]
   */
  async function fetchPeaks(lat, lng, radiusKm = 80) {
    // Use cache if viewpoint moved less than 5km
    if (cachedPeaks && cachedCenter) {
      const moved = Panorama.getDistanceKm(lat, lng, cachedCenter.lat, cachedCenter.lng)
      if (moved < 5) return cachedPeaks
    }

    const radiusM = radiusKm * 1000
    const resp = await fetch(`/api/peaks?lat=${lat}&lng=${lng}&radius=${radiusM}`)

    if (!resp.ok) {
      console.warn('Peak fetch failed:', resp.status)
      return cachedPeaks || []
    }

    const peaks = await resp.json()

    cachedPeaks  = peaks
    cachedCenter = { lat, lng }

    return peaks
  }

  /**
   * clearCache — force a fresh fetch on next call
   */
  function clearCache() {
    cachedPeaks  = null
    cachedCenter = null
  }

  return { fetchPeaks, clearCache }

})()
