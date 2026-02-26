# Earth PeakFinder

Panoramic mountain silhouette scanner. Cast rays across terrain elevation data to generate 2D skyline profiles with automatic peak identification — inspired by [PeakFinder](https://www.peakfinder.com) and [ViewFinder Panoramas](https://viewfinderpanoramas.org/technical.htm).

## How It Works

The core algorithm is a **terrain ray-tracer**:

1. **Set your position** (latitude, longitude, elevation)
2. **For each azimuth** (0–360°), cast a ray outward from the viewer
3. **Sample terrain height** at increasing distances along the ray (using Terrarium RGB elevation tiles)
4. **Correct for Earth's curvature** using the de Ferranti formula (includes atmospheric refraction)
5. **Track the maximum vertical angle** — this is the visible skyline in that direction
6. **Draw the skyline** as a 2D silhouette on a canvas
7. **Label peaks** using named summits from OpenStreetMap

```
For each direction (0° to 360°):
  maxAngle = -Infinity
  For each distance sample (0.3km, 0.5km, ... 300km):
    terrain = getElevation(point along ray)
    terrain -= curvatureDrop(distance)        // Earth curves away
    angle = atan2(terrain - viewerElev, distance)
    if angle > maxAngle → this is the new visible horizon
```

The result is a continuous mountain silhouette — exactly what you see when you stand on a summit and look around.

## Features

- **Ray-traced panoramas** from any point on Earth
- **Terrarium RGB tiles** for terrain elevation (AWS, free, no key needed)
- **Earth curvature correction** with atmospheric refraction
- **Peak labelling** from OpenStreetMap (Overpass API)
- **Three ways to set location**: GPS, map click, manual coordinates
- **Adjustable parameters**: number of rays, max range, field of view, center azimuth
- **Server-side terrain caching** for offline/repeated use
- **Dark ocean-depth themed UI** (EarthContours palette)
- **Hover tooltip** showing azimuth, elevation, and distance at cursor

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Cesium Ion](https://ion.cesium.com/) account (free) — for the access token

### Install & Run

```bash
# Clone the repo
git clone https://github.com/krooney144/Earth-PeakFinder.git
cd Earth-PeakFinder

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Edit .env and add your Cesium Ion token

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Development Mode

```bash
npm run dev    # auto-restarts on file changes (Node --watch)
```

## Project Structure

```
Earth-PeakFinder/
├── server.js              # Express backend (terrain proxy, caching, Overpass proxy)
├── package.json
├── .env.example           # Environment variable template
├── .gitignore
├── public/
│   ├── index.html         # Main page
│   ├── css/
│   │   └── styles.css     # EarthContours ocean-depth theme
│   └── js/
│       ├── panorama.js    # Core ray-tracing engine + canvas rendering
│       ├── terrain.js     # Terrarium RGB tile decoder (client-side)
│       ├── peaks.js       # OSM Overpass API peak fetcher
│       └── app.js         # UI logic, map, scan workflow
└── terrain-cache/         # Auto-created; cached terrain tiles (gitignored)
```

## Architecture

### Frontend (Browser)

| File | Role |
|------|------|
| `panorama.js` | Geographic maths (movePoint, getBearing, Haversine), curvature correction, ray-tracing loop, canvas drawing |
| `terrain.js` | Loads Terrarium PNG tiles from AWS, decodes RGB → elevation, caches tiles in memory |
| `peaks.js` | Fetches named peaks from OSM via server proxy, caches results |
| `app.js` | UI wiring — Leaflet map, inputs, scan button, canvas mouse interaction |

### Backend (Node/Express)

| Route | Purpose |
|-------|---------|
| `GET /api/config` | Returns Cesium token to frontend |
| `GET /api/terrain/:z/:x/:y` | Proxies & caches Cesium terrain tiles |
| `GET /api/peaks?lat=&lng=&radius=` | Proxies Overpass API queries |
| `GET /api/elevation?lat=&lng=` | Single-point elevation lookup |
| `POST /api/elevations` | Batch elevation lookup |

### Terrain Data Source

Primary: **AWS Terrarium RGB tiles** — decoded directly in the browser.
Elevation is encoded as: `elevation = (R × 256 + G + B/256) − 32768`

These tiles are free, require no API key, and are served from S3.
Once loaded, tiles are cached in-memory for the session.

### Earth Curvature Correction

From [ViewFinder Panoramas](https://viewfinderpanoramas.org/technical.htm) (Jonathan de Ferranti):

```
drop_metres = 0.1695 × distance_miles²
```

The constant 0.1695 accounts for atmospheric refraction (light bends, letting you see ~15% further than pure geometry).

## Settings

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Rays | 180–1440 | 720 | Number of azimuth directions to trace |
| Range | 50–300 km | 200 | Maximum ray distance |
| FOV | 30–360° | 360 | Field of view (full panorama or zoomed) |
| Center Az | 0–359° | 180 (S) | Center azimuth when FOV < 360° |

## Performance Notes

Following the techniques described in the [VR panoramic mountain images paper](https://www.researchgate.net/publication/333885875_A_virtual_reality_application_for_augmented_panoramic_mountain_images):

- **Adaptive sampling**: Dense near viewer (300m steps), sparse far away (up to 60km jumps)
- **Batch tile loading**: All terrain tiles for a scan are loaded in parallel
- **Tile caching**: Both browser-side (memory) and server-side (disk) caching
- **Canvas-only rendering**: No WebGL or 3D engine needed — pure 2D Canvas API

## References

- [ViewFinder Panoramas — Technical Notes](https://viewfinderpanoramas.org/technical.htm) — Jonathan de Ferranti's curvature formula and DEM methodology
- [A Virtual Reality Application for Augmented Panoramic Mountain Images](https://www.researchgate.net/publication/333885875_A_virtual_reality_application_for_augmented_panoramic_mountain_images) — Panorama generation techniques
- [PeakFinder](https://www.peakfinder.com) — The inspiration for this project
- [Terrarium Elevation Tiles](https://github.com/tilezen/joerd/blob/master/docs/formats.md) — RGB-encoded elevation tile format
- [Overpass API](https://overpass-api.de/) — OpenStreetMap query API for peak data

## Future Plans

- React Native mobile app
- Integration with Earth Contours project
- Offline tile pre-downloading for specific regions
- Telescope/zoom mode for detailed peak inspection
- Sun/moon position overlay
- Photo overlay alignment

## License

MIT
