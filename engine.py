"""The FleetRoutingEngine ties the graph, algorithms, conditions and benchmark
together and holds the live graph state. Its public method signatures are kept
identical to the original so app.py and the frontend are unaffected by the
internal refactor.
"""
import networkx as nx

import config
from core import algorithms, benchmark, conditions
from core.graph import build_graph, serialize

class FleetRoutingEngine:
    def __init__(self):
        self.G = build_graph()

    def _apply_strategy_weights(self, strategy):
        """Temporarily adjust edge costs for the chosen optimisation strategy.
        Returns the original costs so they can be restored afterwards."""
        originals = {}
        for u, v in self.G.edges():
            e = self.G.edges[u, v]
            originals[(u, v)] = e['current_cost']
            if strategy == "weather" and e.get('weather_event', False):
                e['current_cost'] += e['base_cost'] * 3.0
            elif strategy == "traffic" and e.get('congestion', 0) > 0:
                e['current_cost'] += e['congestion'] * 200
            elif strategy == "distance":
                e['current_cost'] = e['base_cost']

        return originals

    def _restore_costs(self, originals):
        for (u, v), cost in originals.items():
            self.G.edges[u, v]['current_cost'] = cost

    def get_route(self, source, destination, algorithm="astar", strategy="balanced"):
        originals = None
        try:
            originals = self._apply_strategy_weights(strategy)
            path = algorithms.shortest_path(self.G, source, destination, algorithm=algorithm)
            self._restore_costs(originals)

            base_cost_km = sum(self.G.edges[path[i], path[i + 1]]['base_cost']
                               for i in range(len(path) - 1))

            for i in range(len(path) - 1):
                u, v = path[i], path[i + 1]
                self.G.edges[u, v]['congestion'] += 1
                self.G.edges[u, v]['current_cost'] += config.CONGESTION_PENALTY

            return {"success": True, "path": path, "base_cost": base_cost_km,
                    "algorithm": algorithm, "strategy": strategy}
        except nx.NetworkXNoPath:
            if originals:
                self._restore_costs(originals)
            return {"success": False, "error": "No path could be found."}
        except nx.NodeNotFound as e:
            if originals:
                self._restore_costs(originals)
            return {"success": False, "error": str(e)}

    def explore_route(self, source, destination, algorithm="astar", strategy="balanced"):
        """Run the instrumented algorithm and return exploration frames for the
        visualiser. Does NOT mutate congestion (it's a read-only analysis)."""
        originals = self._apply_strategy_weights(strategy)
        try:
            result = algorithms.explore(self.G, source, destination, algorithm=algorithm)
        finally:
            self._restore_costs(originals)
        if not result["path"]:
            return {"success": False, "error": "No path could be found.",
                    "frames": result["frames"], "explored": result["explored"]}
        return {"success": True, "algorithm": algorithm, **result}

    def toggle_obstacle(self, u, v):
        if not self.G.has_edge(u, v):
            return False
        edge = self.G.edges[u, v]
        if edge['obstacle']:
            edge['obstacle'] = False
            edge['current_cost'] = edge['base_cost'] + edge['congestion'] * config.CONGESTION_PENALTY
            if edge['weather_event']:
                edge['current_cost'] += edge['base_cost'] * config.WEATHER_PENALTY_DEFAULT
        else:
            edge['obstacle'] = True
            edge['current_cost'] = config.OBSTACLE_PENALTY
        return True

    def reset_graph(self):
        for u, v in self.G.edges():
            e = self.G.edges[u, v]
            e['current_cost'] = float(e['base_cost'])
            e['congestion'] = 0
            e['obstacle'] = False
            e['weather_event'] = False

    def simulate_weather(self):
        return conditions.simulate_weather(self.G)

    def fetch_real_weather(self):
        return conditions.fetch_real_weather(self.G)

    def sync_live_traffic(self):
        return conditions.simulate_traffic(self.G)

    def sync_real_traffic(self):
        return conditions.fetch_real_traffic(self.G)

    def scalability_benchmark(self, source, destination):
        return benchmark.run(self.G, source, destination)

    def get_graph(self):
        return serialize(self.G)

engine = FleetRoutingEngine()
