"""Run with .venv/bin/python app.py; serves the local Route Explorer."""
import argparse
from collections import OrderedDict
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit

from analysis.first_hill import ROUTE_ID
from src.route_explorer import build_dashboard_data, refresh_sources, route_catalog
from src import oba

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    print("Loading First Hill analysis and cached street geometry…", flush=True)
    catalog = route_catalog()
    allowed_routes = {r["route_id"] for r in catalog} | {ROUTE_ID}
    cache = OrderedDict()
    lock = threading.Lock()

    def payload(route_id):
        if route_id not in cache:
            cache[route_id] = json.dumps(build_dashboard_data(route_id), allow_nan=False).encode()
            if len(cache) > 4:
                cache.popitem(last=False)
        cache.move_to_end(route_id)
        return cache[route_id]

    payload(ROUTE_ID)

    class Handler(BaseHTTPRequestHandler):
        def send_body(self, body, content_type="application/json", status=200):
            self.send_response(status)
            self.send_header("Content-Type", content_type + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def error(self, message, status=400):
            self.send_body(json.dumps({"error": message}).encode(), status=status)

        def route_id(self):
            route_id = parse_qs(urlsplit(self.path).query).get("route", [ROUTE_ID])[0]
            if route_id not in allowed_routes:
                raise ValueError("Choose a route from the route catalog.")
            return route_id

        def do_GET(self):
            path = urlsplit(self.path).path
            assets = {"/": ("index.html", "text/html"),
                      "/app.js": ("app.js", "text/javascript"),
                      "/map.js": ("map.js", "text/javascript"),
                      "/style.css": ("style.css", "text/css")}
            try:
                if path == "/api/data":
                    with lock:
                        body = payload(self.route_id())
                    self.send_body(body)
                elif path == "/api/routes":
                    self.send_body(json.dumps(catalog).encode())
                elif path == "/api/departures":
                    query = parse_qs(urlsplit(self.path).query)
                    route_id = self.route_id()
                    stop_id = query.get("stop", [""])[0]
                    with lock:
                        route_payload = json.loads(payload(route_id))
                    stop = next((item for item in route_payload["stops"] if item["id"] == stop_id), None)
                    if not stop:
                        raise ValueError("Choose a stop on the selected route.")
                    departures = oba.get_departures(stop.get("oba_stop_ids", []))
                    self.send_body(json.dumps({"departures": departures}).encode())
                elif path in assets:
                    filename, content_type = assets[path]
                    self.send_body((ROOT / "web" / filename).read_bytes(), content_type)
                else:
                    self.send_error(404)
            except (ValueError, RuntimeError) as exc:
                self.error(str(exc))
            except Exception:
                # Network exceptions can contain API credentials in request URLs.
                self.error("Unable to load data. Check local data files, network access and OBA_API_KEY.", 503)

        def do_POST(self):
            if urlsplit(self.path).path != "/api/refresh":
                self.send_error(404)
                return
            # Only the local dashboard can initiate potentially large downloads.
            if (self.headers.get("X-Route-Explorer") != "1"
                    or self.headers.get("Origin") not in
                    {f"http://127.0.0.1:{args.port}", f"http://localhost:{args.port}"}):
                self.error("Refresh must be requested from the local dashboard.", 403)
                return
            try:
                route_id = self.route_id()
                source = parse_qs(urlsplit(self.path).query).get("source", [""])[0]
                with lock:
                    refresh_sources(route_id, source)
                    cache.clear()
                    body = payload(route_id)
                self.send_body(body)
            except (ValueError, RuntimeError) as exc:
                self.error(str(exc))
            except Exception:
                self.error("Refresh failed. Check network access and OBA_API_KEY, then retry.", 503)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Route Explorer running at http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
