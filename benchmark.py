"""Honest scalability benchmark.

The previous version measured real timings and then multiplied them by invented
factors and clamped the ordering to force a "nice" chart — which is scientific
fraud. This version reports what actually happens:

* primary metric: **nodes explored** (settled) by each algorithm to reach the
  target. With an admissible heuristic, A* settles fewer nodes than Dijkstra —
  this is the real, defensible evidence of the heuristic's value, and it holds
  even on a small graph.
* secondary metric: **wall-clock time (ms)**, averaged over many repeats. On a
  small graph these are tiny and noisy; we report them as-is and let the chart
  speak for itself.
"""
import time

import networkx as nx

from core import algorithms

_ALGOS = ["dijkstra", "astar", "bellman_ford", "greedy_bfs"]
_FLEET_SIZES = [2, 4, 6, 8, 10, 12]
_TIMING_REPEATS = 50

def _fresh_costs(G):
    """Reset current_cost to base_cost on a graph copy (so congestion penalties
    from a previous run don't leak into the measurement)."""
    H = G.copy()
    for u, v in H.edges():
        H.edges[u, v]['current_cost'] = float(H.edges[u, v]['base_cost'])
    return H

def run(G, source, destination):
    """Return a list of per-fleet-size records with explored-node counts and
    timings for each algorithm. Raises if source/destination are invalid."""
    results = []
    for n in _FLEET_SIZES:
        record = {"trucks": n}

        for algo in _ALGOS:

            H = _fresh_costs(G)
            explored_total = 0
            for _ in range(n):
                res = algorithms.explore(H, source, destination, algorithm=algo)
                explored_total += res["explored"]

                for i in range(len(res["path"]) - 1):
                    H.edges[res["path"][i], res["path"][i + 1]]['current_cost'] += 50
            record[f"{algo}_explored"] = round(explored_total / n, 1)

            total = 0.0
            for _ in range(_TIMING_REPEATS):
                H = _fresh_costs(G)
                t0 = time.perf_counter()
                for _ in range(n):
                    p = algorithms.shortest_path(H, source, destination, algorithm=algo)
                    for i in range(len(p) - 1):
                        H.edges[p[i], p[i + 1]]['current_cost'] += 50
                total += time.perf_counter() - t0
            record[f"{algo}_ms"] = round((total / _TIMING_REPEATS) * 1000, 4)

        results.append(record)
    return results
