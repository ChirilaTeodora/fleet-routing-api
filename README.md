# Smart Fleet Routing

Interactive fleet-routing demonstrator over the Romanian road network, built for
a bachelor's thesis. It compares classical pathfinding algorithms, visualises how
they explore the graph, applies congestion-aware load-balancing across a fleet,
and draws routes along **real road geometry**.

## Features

- **Pathfinding algorithms**: A*, Dijkstra, Bellman-Ford, and Weighted A*
  (greedy, non-optimal heuristic), all over a 42-city graph (Romanian county
  seats + Bucharest) with real driving distances.
- **Algorithm visualizer**: step-by-step animation on the map showing the
  *current* node, the *frontier*, and *visited* cities, with a live counter of
  **nodes explored** — the metric that shows A*'s admissible heuristic settles
  fewer cities than Dijkstra for the same optimal path.
- **Load-balancing**: each dispatched vehicle penalises the roads it uses, so the
  next vehicle is rerouted — the fleet spreads across alternative paths.
- **Real road geometry**: routes follow actual roads (pre-fetched from OSRM and
  cached locally), not straight lines.
- **Live conditions**: simulated/real weather (Open-Meteo ECMWF) and traffic
  (TomTom), road blocking, congestion heatmap.
- **Honest benchmark**: real measurements of nodes explored and computation time
  per fleet size — no fabricated numbers.

## Architecture

```
app.py            FastAPI app — thin HTTP layer, delegates to the engine
config.py         All tunable constants + secrets loaded from .env
core/
  graph.py        City/road graph + serialization + geometry loading
  algorithms.py   haversine heuristic, NetworkX wrappers, instrumented explore()
  conditions.py   Weather (sim + Open-Meteo) and traffic (sim + TomTom)
  benchmark.py    Honest scalability benchmark (explored nodes + timing)
  engine.py       FleetRoutingEngine — holds graph state, orchestrates
routing.py        Backward-compatible shim (re-exports the engine)
data/
  road_geometry.json   Cached real road polylines (generated once)
scripts/
  fetch_road_geometry.py   One-time geometry downloader
static/           Leaflet UI (index.html, script.js, style.css)
```

## Setup

```bash
pip install -r requirements.txt

# Copy the env template and add your TomTom key (optional — used for real traffic)
cp .env.example .env      # Windows: copy .env.example .env

# (One-time) download real road geometry for the road network.
# If skipped, the app still works but draws straight lines between cities.
python scripts/fetch_road_geometry.py

# Run the app
python app.py
```

Open http://localhost:8000.

## Regenerating the graph / geometry

If you edit the cities or roads in `core/graph.py`, re-run
`python scripts/fetch_road_geometry.py` to refresh `data/road_geometry.json`.
The script resumes from the existing cache and only fetches missing edges.

## API endpoints

| Method | Path                  | Purpose                                   |
|--------|-----------------------|-------------------------------------------|
| GET    | `/api/graph`          | Cities + roads (with geometry)            |
| POST   | `/api/route`          | Shortest path (mutates congestion)        |
| POST   | `/api/route/explore`  | Step-by-step exploration trace (read-only)|
| POST   | `/api/obstacle`       | Toggle a road block                       |
| POST   | `/api/reset`          | Clear congestion / blocks / weather       |
| POST   | `/api/weather`        | Simulated weather                         |
| POST   | `/api/weather/real`   | Real weather (Open-Meteo ECMWF)           |
| POST   | `/api/traffic/sync`   | Real traffic (TomTom, falls back to sim)  |
| GET    | `/api/scalability`    | Benchmark data (explored nodes + timing)  |

## Notes on the algorithms

- The A* heuristic is the great-circle (haversine) distance, which never
  overestimates the real road distance, so A* is **admissible** and returns the
  optimal path — verified to match Dijkstra's path in tests.
- "Weighted A*" doubles the heuristic, making it greedy: faster / fewer nodes
  but not guaranteed optimal. It is *not* breadth-first search.
- The Smart-vs-Naive comparison's congestion penalty (+35% per extra truck on a
  shared route) is a deliberate teaching simplification (BPR-lite), not a
  calibrated traffic model.
