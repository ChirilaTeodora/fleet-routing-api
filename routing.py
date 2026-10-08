"""Backward-compatible shim.

The routing logic moved into the `core` package (graph / algorithms /
conditions / benchmark / engine). This module re-exports the engine singleton
and the haversine helper so any existing `from routing import engine` keeps
working.
"""
from core.algorithms import haversine
from core.engine import FleetRoutingEngine, engine

__all__ = ["engine", "FleetRoutingEngine", "haversine"]
