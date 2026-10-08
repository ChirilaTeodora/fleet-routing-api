"""Builds the road network graph for Romania.

Nodes are real cities (all 41 county-seat municipalities + Bucharest, i.e. the
major decision points a router actually chooses between). Edges are real road
links with approximate driving distances in km.

Edge geometry (the curved shape the road follows on the map) is loaded lazily
from data/road_geometry.json when available; the algorithm never uses it — it
is purely for drawing realistic routes instead of straight lines.
"""
import json
import os

import networkx as nx

_GEOMETRY_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "road_geometry.json")

CITIES = {
    "Bucuresti":       (44.4268, 26.1025),
    "Alba Iulia":      (46.0695, 23.5741),
    "Arad":            (46.1866, 21.3123),
    "Pitesti":         (44.8565, 24.8692),
    "Bacau":           (46.5670, 26.9146),
    "Oradea":          (47.0465, 21.9189),
    "Bistrita":        (47.1300, 24.5000),
    "Botosani":        (47.7484, 26.6694),
    "Brasov":          (45.6427, 25.5887),
    "Braila":          (45.2692, 27.9574),
    "Buzau":           (45.1500, 26.8200),
    "Resita":          (45.3000, 21.8890),
    "Calarasi":        (44.2058, 27.3306),
    "Cluj":            (46.7712, 23.5914),
    "Constanta":       (44.1792, 28.6498),
    "Sfantu Gheorghe": (45.8667, 25.7833),
    "Targoviste":      (44.9244, 25.4567),
    "Craiova":         (44.3302, 23.7949),
    "Galati":          (45.4353, 28.0080),
    "Giurgiu":         (43.9037, 25.9699),
    "Targu Jiu":       (45.0356, 23.2747),
    "Miercurea Ciuc":  (46.3597, 25.8011),
    "Deva":            (45.8800, 22.9100),
    "Slobozia":        (44.5639, 27.3661),
    "Iasi":            (47.1585, 27.6014),
    "Baia Mare":       (47.6533, 23.5795),
    "Drobeta":         (44.6302, 22.6566),
    "Targu Mures":     (46.5424, 24.5575),
    "Piatra Neamt":    (46.9275, 26.3708),
    "Slatina":         (44.4300, 24.3700),
    "Ploiesti":        (44.9367, 26.0125),
    "Satu Mare":       (47.7900, 22.8856),
    "Zalau":           (47.1910, 23.0570),
    "Sibiu":           (45.7983, 24.1256),
    "Suceava":         (47.6514, 26.2556),
    "Alexandria":      (43.9736, 25.3340),
    "Timisoara":       (45.7489, 21.2087),
    "Tulcea":          (45.1667, 28.8000),
    "Ramnicu Valcea":  (45.0997, 24.3692),
    "Vaslui":          (46.6407, 27.7276),
    "Focsani":         (45.6960, 27.1840),
    "Vatra Dornei":    (47.3486, 25.3589),
}

ROADS = [
    ("Bucuresti", "Ploiesti", 60),
    ("Bucuresti", "Pitesti", 110),
    ("Bucuresti", "Targoviste", 80),
    ("Bucuresti", "Giurgiu", 65),
    ("Bucuresti", "Calarasi", 120),
    ("Bucuresti", "Alexandria", 90),
    ("Bucuresti", "Buzau", 110),
    ("Bucuresti", "Constanta", 225),
    ("Ploiesti", "Brasov", 105),
    ("Ploiesti", "Buzau", 70),
    ("Ploiesti", "Targoviste", 50),
    ("Pitesti", "Craiova", 140),
    ("Pitesti", "Ramnicu Valcea", 60),
    ("Pitesti", "Slatina", 60),
    ("Pitesti", "Brasov", 150),
    ("Targoviste", "Brasov", 130),
    ("Brasov", "Sibiu", 140),
    ("Brasov", "Sfantu Gheorghe", 35),
    ("Brasov", "Targu Mures", 170),
    ("Brasov", "Miercurea Ciuc", 100),
    ("Sfantu Gheorghe", "Miercurea Ciuc", 65),
    ("Sibiu", "Ramnicu Valcea", 95),
    ("Sibiu", "Alba Iulia", 70),
    ("Sibiu", "Deva", 150),
    ("Alba Iulia", "Cluj", 100),
    ("Alba Iulia", "Deva", 85),
    ("Alba Iulia", "Targu Mures", 110),
    ("Cluj", "Oradea", 155),
    ("Cluj", "Zalau", 90),
    ("Cluj", "Bistrita", 110),
    ("Cluj", "Targu Mures", 105),
    ("Cluj", "Baia Mare", 150),
    ("Oradea", "Arad", 120),
    ("Oradea", "Satu Mare", 135),
    ("Oradea", "Zalau", 95),
    ("Arad", "Timisoara", 55),
    ("Arad", "Deva", 150),
    ("Timisoara", "Resita", 75),
    ("Timisoara", "Drobeta", 230),
    ("Resita", "Drobeta", 150),
    ("Deva", "Targu Jiu", 130),
    ("Drobeta", "Targu Jiu", 110),
    ("Drobeta", "Craiova", 115),
    ("Targu Jiu", "Ramnicu Valcea", 100),
    ("Targu Jiu", "Craiova", 105),
    ("Craiova", "Slatina", 50),
    ("Craiova", "Alexandria", 130),
    ("Slatina", "Ramnicu Valcea", 70),
    ("Alexandria", "Giurgiu", 80),
    ("Giurgiu", "Calarasi", 110),
    ("Calarasi", "Constanta", 130),
    ("Calarasi", "Slobozia", 55),
    ("Slobozia", "Buzau", 80),
    ("Slobozia", "Braila", 90),
    ("Constanta", "Tulcea", 125),
    ("Buzau", "Braila", 90),
    ("Buzau", "Focsani", 80),
    ("Braila", "Galati", 25),
    ("Braila", "Tulcea", 90),
    ("Galati", "Tulcea", 80),
    ("Galati", "Focsani", 80),
    ("Focsani", "Bacau", 95),
    ("Focsani", "Vaslui", 110),
    ("Bacau", "Piatra Neamt", 60),
    ("Bacau", "Iasi", 130),
    ("Bacau", "Vaslui", 85),
    ("Piatra Neamt", "Suceava", 105),
    ("Piatra Neamt", "Targu Mures", 160),
    ("Piatra Neamt", "Vatra Dornei", 110),
    ("Iasi", "Vaslui", 70),
    ("Iasi", "Botosani", 120),
    ("Iasi", "Suceava", 145),
    ("Botosani", "Suceava", 40),
    ("Suceava", "Vatra Dornei", 110),
    ("Vatra Dornei", "Bistrita", 90),
    ("Bistrita", "Baia Mare", 130),
    ("Bistrita", "Targu Mures", 90),
    ("Baia Mare", "Satu Mare", 65),
    ("Satu Mare", "Zalau", 75),
    ("Targu Mures", "Sibiu", 120),
    ("Vaslui", "Galati", 130),
]

def _load_geometry():
    """Return {edge_key: [[lat,lng], ...]} or {} if the cache file is absent.
    Keys are 'CityA|CityB' with the two cities sorted alphabetically."""
    try:
        with open(_GEOMETRY_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def geometry_key(u, v):
    """Symmetric key for an undirected edge."""
    return "|".join(sorted([u, v]))

def build_graph():
    """Construct and return the road-network Graph with cost attributes."""
    G = nx.Graph()
    for city, (lat, lng) in CITIES.items():
        G.add_node(city, lat=lat, lng=lng)

    geometry = _load_geometry()
    for u, v, km in ROADS:
        G.add_edge(u, v,
                   base_cost=float(km),
                   current_cost=float(km),
                   congestion=0,
                   obstacle=False,
                   weather_event=False,
                   geometry=geometry.get(geometry_key(u, v)))
    return G

def serialize(G):
    """JSON-serialisable view of the graph for the frontend.
    Keeps the historical contract and adds an optional `geometry` field."""
    nodes = [{"id": n, "lat": d["lat"], "lng": d["lng"]}
             for n, d in G.nodes(data=True)]
    edges = [
        {
            "source": u,
            "target": v,
            "cost": d["current_cost"],
            "base_cost": d["base_cost"],
            "obstacle": d["obstacle"],
            "congestion": d.get("congestion", 0),
            "weather_event": d.get("weather_event", False),
            "geometry": d.get("geometry"),
        }
        for u, v, d in G.edges(data=True)
    ]
    return {"nodes": nodes, "edges": edges}
