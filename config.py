"""Central configuration for the Fleet Routing engine.

All "magic numbers" that tune the routing behaviour live here with an
explanation of what they model, plus secrets loaded from a local .env file
(never hard-coded in source).
"""
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:

    pass

                                                                     
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY", "")

                                                                              

                                                                            
CONGESTION_PENALTY = 50

                                                                    
OBSTACLE_PENALTY = 99999

                                                                             

WEATHER_PENALTY_DEFAULT = 0.5                              
WEATHER_PENALTY_SNOW = 1.0                           

RAIN_THRESHOLD_MM = 2                                                     
WIND_THRESHOLD_KMH = 50                                                  

                                                                           
TRAFFIC_SIM_PENALTY_PER_UNIT = 150

TRAFFIC_REAL_KM_PER_DELAY_SEC = 0.5

TRAFFIC_MIN_DELAY_SEC = 30

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OSRM_URL = "https://router.project-osrm.org"

AVG_SPEED_KMH = 80
