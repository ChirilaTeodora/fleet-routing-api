"""Environmental conditions that change edge costs: weather and traffic.

Each function mutates the graph's `current_cost` / flags in place and returns
a list of event dicts for the UI. Real-data functions (Open-Meteo, TomTom)
fall back to simulation when the live service returns nothing, so the demo
always has something to show.
"""
import random

import requests

import config

def simulate_weather(G):
    """Randomly mark up to 3 segments with a storm (+50% cost)."""
    edges = list(G.edges())
    affected = random.sample(edges, min(3, len(edges)))
    events = []
    for u, v in affected:
        G.edges[u, v]['current_cost'] += G.edges[u, v]['base_cost'] * config.WEATHER_PENALTY_DEFAULT
        G.edges[u, v]['weather_event'] = True
        events.append({"source": u, "target": v, "type": "storm"})
    return events

def fetch_real_weather(G):
    """Query Open-Meteo (ECMWF model) at each segment midpoint and penalise
    segments with precipitation, high wind, or snow. Falls back to simulation
    if no severe weather is found anywhere."""
    events = []
    for u, v in list(G.edges()):
        node_u, node_v = G.nodes[u], G.nodes[v]
        lat = (node_u['lat'] + node_v['lat']) / 2
        lng = (node_u['lng'] + node_v['lng']) / 2
        params = {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lng:.4f}",
            "current": "precipitation,wind_speed_10m,snowfall",
            "forecast_days": 1,
            "models": "ecmwf_ifs025",
        }
        try:
            resp = requests.get(config.OPEN_METEO_URL, params=params, timeout=3)
            if resp.status_code != 200:
                continue
            current = resp.json().get('current', {})
            precip = current.get('precipitation', 0) or 0
            wind = current.get('wind_speed_10m', 0) or 0
            snow = current.get('snowfall', 0) or 0

            event_type = None
            if snow > 0:
                event_type = "snow"
            elif precip > config.RAIN_THRESHOLD_MM:
                event_type = "rain"
            elif wind > config.WIND_THRESHOLD_KMH:
                event_type = "wind"

            if event_type:
                fraction = (config.WEATHER_PENALTY_SNOW if event_type == "snow"
                            else config.WEATHER_PENALTY_DEFAULT)
                G.edges[u, v]['current_cost'] += G.edges[u, v]['base_cost'] * fraction
                G.edges[u, v]['weather_event'] = True
                events.append({
                    "source": u, "target": v, "type": event_type,
                    "precipitation": precip, "wind_speed": wind, "snowfall": snow,
                })
        except requests.RequestException as e:
            print(f"Open-Meteo API failed for {u}-{v}: {e}")

    if not events:
        print("No severe weather detected via ECMWF. Falling back to simulated weather.")
        return simulate_weather(G)
    return events

def simulate_traffic(G):
    """Simulate real-time traffic surges on ~25% of the network."""
    events = []
    edges = list(G.edges())
    affected = random.sample(edges, max(1, int(len(edges) * 0.25)))
    for u, v in affected:
        intensity = random.randint(3, 6)
        G.edges[u, v]['congestion'] += intensity
        G.edges[u, v]['current_cost'] += intensity * config.TRAFFIC_SIM_PENALTY_PER_UNIT
        events.append({"source": u, "target": v, "intensity": intensity,
                       "delay_mins": intensity * 15})
    return events

def fetch_real_traffic(G):
    """Query TomTom for real traffic delays on a sample of segments.
    Falls back to simulation if no real traffic is found."""
    if not config.TOMTOM_API_KEY:
        print("No TomTom API key configured. Using simulated traffic.")
        return simulate_traffic(G)

    events = []
    edges = list(G.edges())
    affected = random.sample(edges, min(12, len(edges)))
    for u, v in affected:
        node_u, node_v = G.nodes[u], G.nodes[v]
        lat1, lng1 = node_u['lat'], node_u['lng']
        lat2, lng2 = node_v['lat'], node_v['lng']
        url = (f"https://api.tomtom.com/routing/1/calculateRoute/"
               f"{lat1},{lng1}:{lat2},{lng2}/json")
        params = {"key": config.TOMTOM_API_KEY,
                  "computeTravelTimeFor": "all", "traffic": "true"}
        try:
            resp = requests.get(url, params=params, timeout=3)
            if resp.status_code != 200:
                continue
            summary = resp.json()['routes'][0]['summary']
            delay_sec = summary.get('trafficDelayInSeconds', 0)
            if delay_sec > config.TRAFFIC_MIN_DELAY_SEC:
                delay_cost = delay_sec * config.TRAFFIC_REAL_KM_PER_DELAY_SEC
                intensity = max(1, int(delay_sec / 120))
                G.edges[u, v]['current_cost'] += delay_cost
                G.edges[u, v]['congestion'] += intensity
                events.append({"source": u, "target": v, "intensity": intensity,
                               "delay_mins": round(delay_sec / 60)})
        except (requests.RequestException, KeyError, IndexError) as e:
            print(f"TomTom API failed for {u}-{v}: {e}")

    if not events:
        print("No real traffic found. Falling back to simulated traffic.")
        return simulate_traffic(G)
    return events
