"""One-time script: download real road geometry for every edge in the graph
and cache it to data/road_geometry.json.

Run this manually ONCE (and re-run only if you change the road network):

    python scripts/fetch_road_geometry.py

It queries the public OSRM demo server for the driving route between each pair
of connected cities and stores the polyline (list of [lat, lng] points). At
runtime the app just reads the JSON file — no API calls, no rate limits.

If OSRM is unreachable for an edge, that edge is left without geometry and the
app falls back to drawing a straight line for it.
"""
import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.graph import CITIES, ROADS, geometry_key              
import config              

OUTPUT = os.path.join(os.path.dirname(__file__), "..", "data", "road_geometry.json")
SLEEP_BETWEEN = 1.0                                       

def fetch_edge(u, v):
    lat1, lng1 = CITIES[u]
    lat2, lng2 = CITIES[v]
    url = (f"{config.OSRM_URL}/route/v1/driving/"
           f"{lng1},{lat1};{lng2},{lat2}")
    params = {"overview": "full", "geometries": "geojson"}
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    coords = resp.json()["routes"][0]["geometry"]["coordinates"]

    return [[lat, lng] for lng, lat in coords]

def main():
    geometry = {}

    if os.path.exists(OUTPUT):
        with open(OUTPUT, encoding="utf-8") as f:
            geometry = json.load(f)

    total = len(ROADS)
    for i, (u, v, _km) in enumerate(ROADS, 1):
        key = geometry_key(u, v)
        if key in geometry:
            print(f"[{i}/{total}] skip {key} (cached)")
            continue
        try:
            geometry[key] = fetch_edge(u, v)
            print(f"[{i}/{total}] ok   {key} ({len(geometry[key])} pts)")
        except Exception as e:                                                
            print(f"[{i}/{total}] FAIL {key}: {e}")
        time.sleep(SLEEP_BETWEEN)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(geometry, f)
    print(f"\nSaved {len(geometry)} edges to {os.path.relpath(OUTPUT)}")

if __name__ == "__main__":
    main()
