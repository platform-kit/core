---
description: Current forecasts and active weather alerts from the National Weather Service.
openapi: https://api.weather.gov/openapi.json
operations: [point, gridpoint_forecast, gridpoint_forecast_hourly, alerts_active]
headers:
  User-Agent: "PlatformKit demo assistant (contact: hello@example.com)"
published: true
---
Use the point operation first to find a location's forecast office and grid coordinates. Then use
the matching daily or hourly forecast operation. For alerts, pass the location as latitude,longitude.
The National Weather Service API covers the United States.
