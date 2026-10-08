"""Pathfinding algorithms and the A* heuristic.

We provide two kinds of pathfinding:

1. Thin wrappers over NetworkX (`shortest_path`) used for the production
   routing endpoint — battle-tested and fast.
2. *Instrumented* hand-written Dijkstra / A* (`explore`) that record the
   exploration order (which nodes were popped, what the frontier looked like)
   so the UI can visualise *how* each algorithm searches, and so we can count
   how many nodes each one explores — the key metric that shows A*'s heuristic
   makes it open fewer nodes than Dijkstra.
"""
import heapq
import math

import networkx as nx

def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in km. Always <= the real road distance, which
    makes it an *admissible* A* heuristic (never overestimates)."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def heuristic(G, a, b):
    """Admissible heuristic for A*: straight-line distance between two nodes."""
    na, nb = G.nodes[a], G.nodes[b]
    return haversine(na['lat'], na['lng'], nb['lat'], nb['lng'])

def greedy_heuristic(G, a, b):
    """Non-admissible heuristic (2x straight-line). Makes A* behave greedily:
    faster / fewer nodes explored, but may miss the optimal path."""
    return heuristic(G, a, b) * 2.0

def shortest_path(G, source, target, algorithm="astar", weight="current_cost"):
    """Return the path as a list of node ids using the requested algorithm.
    Raises nx.NetworkXNoPath / nx.NodeNotFound like the underlying NetworkX calls."""
    if algorithm == "dijkstra":
        return nx.dijkstra_path(G, source=source, target=target, weight=weight)
    if algorithm == "bellman_ford":
        return nx.bellman_ford_path(G, source=source, target=target, weight=weight)
    if algorithm == "greedy_bfs":
        return nx.astar_path(G, source=source, target=target,
                             heuristic=lambda a, b: greedy_heuristic(G, a, b), weight=weight)

    return nx.astar_path(G, source=source, target=target,
                         heuristic=lambda a, b: heuristic(G, a, b), weight=weight)

def explore(G, source, target, algorithm="astar", weight="current_cost"):
    """Run Dijkstra or A* by hand, recording every step.

    Returns a dict:
      {
        "path":     [node, ...]    final shortest path (empty if none),
        "explored": int            number of nodes popped/settled,
        "frames":   [ {current, visited:[...], frontier:[...]} , ... ]
      }

    "explored" is the headline metric: with an admissible heuristic A* settles
    fewer nodes than Dijkstra for the same source/target.
    """
    use_heuristic = algorithm in ("astar", "greedy_bfs")
    h = greedy_heuristic if algorithm == "greedy_bfs" else heuristic

    def h_cost(n):
        return h(G, n, target) if use_heuristic else 0.0

    counter = 0
    g_score = {source: 0.0}
    came_from = {}
    open_heap = [(h_cost(source), counter, source)]
    open_set = {source}
    visited = []                                                        
    frames = []

    while open_heap:
        _, _, current = heapq.heappop(open_heap)
        if current in visited:
            continue
        open_set.discard(current)
        visited.append(current)

        frames.append({
            "current": current,
            "visited": list(visited),
            "frontier": list(open_set),
        })

        if current == target:
            break

        for neighbor in G.neighbors(current):
            if neighbor in visited:
                continue
            edge_w = G.edges[current, neighbor].get(weight, 1.0)
            tentative_g = g_score[current] + edge_w
            if tentative_g < g_score.get(neighbor, float("inf")):
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g
                f = tentative_g + h_cost(neighbor)
                counter += 1
                heapq.heappush(open_heap, (f, counter, neighbor))
                open_set.add(neighbor)

    path = []
    if target in visited or target == source:
        node = target
        while node != source:
            path.append(node)
            if node not in came_from:
                path = []                       
                break
            node = came_from[node]
        if path:
            path.append(source)
            path.reverse()
        elif target == source:
            path = [source]

    return {"path": path, "explored": len(visited), "frames": frames}
