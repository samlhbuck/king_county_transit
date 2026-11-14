FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 MPLBACKEND=Agg MPLCONFIGDIR=/tmp/matplotlib HOST=0.0.0.0 ROUTE_LENS_HOSTED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY src ./src
COPY analysis ./analysis
COPY web ./web
COPY data ./data
RUN test -f data/processed/development_permits.csv && test -f data/reference/agency_route.json
RUN useradd --uid 10001 --create-home routeapp && chown -R routeapp:routeapp /app
# Bootstrap fixes the mounted volume's ownership and drops to routeapp.
USER root
CMD ["python", "-m", "src.hosted"]
