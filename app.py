from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from routing import engine

app = FastAPI(title="Smart Fleet Routing API")

class RouteRequest(BaseModel):
    source: str
    destination: str
    algorithm: str = "astar"
    strategy: str = "balanced"

class ObstacleRequest(BaseModel):
    u: str
    v: str

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def index():
    return FileResponse("static/index.html")

@app.get("/api/graph")
def get_graph():
    return engine.get_graph()

@app.post("/api/route")
def get_route(req: RouteRequest):
    return engine.get_route(req.source, req.destination,
                            algorithm=req.algorithm, strategy=req.strategy)

@app.post("/api/route/explore")
def explore_route(req: RouteRequest):
    """Step-by-step exploration trace (visited / frontier / current node) for
    the algorithm visualiser. Read-only: does not change congestion state."""
    return engine.explore_route(req.source, req.destination,
                                algorithm=req.algorithm, strategy=req.strategy)

@app.post("/api/obstacle")
def toggle_obstacle(req: ObstacleRequest):
    success = engine.toggle_obstacle(req.u, req.v)
    return {"success": success}

@app.post("/api/reset")
def reset_congestion():
    engine.reset_graph()
    return {"success": True}

@app.post("/api/weather")
def simulate_weather():
    events = engine.simulate_weather()
    return {"success": True, "events": events}

@app.post("/api/weather/real")
def real_weather():
    """Fetch real weather data from Open-Meteo ECMWF model."""
    events = engine.fetch_real_weather()
    return {"success": True, "events": events}

@app.post("/api/traffic/sync")
def sync_traffic():
    events = engine.sync_real_traffic()
    return {"success": True, "events": events}

@app.get("/api/scalability")
def scalability_benchmark(source: str = "Bucuresti", destination: str = "Suceava"):
    """Run Dijkstra vs A* benchmark and return timing data for chart."""
    return engine.scalability_benchmark(source, destination)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
