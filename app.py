"""Run with .venv/bin/python app.py; serves the local Route Explorer."""
import argparse
from collections import OrderedDict
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit

from analysis.first_hill import ROUTE_ID
from src.route_explorer import build_dashboard_data, refresh_sources, route_catalog
from src import oba
from src.departures import route_departures
from src.origins import cached_boarding_stops
from src.feedback import FeedbackStore, RateLimiter, database_path, RETENTION_DAYS

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    args = parser.parse_args()
    print("Loading First Hill analysis and cached street geometry…", flush=True)
    catalog = route_catalog()
    allowed_routes = {r["route_id"] for r in catalog} | {ROUTE_ID}
    cache = OrderedDict()
    lock = threading.Lock()
    feedback = None
    path = database_path()
    if path is not None:
        try:
            feedback = FeedbackStore(path)
        except Exception as error:
            print(f'Feedback storage unavailable ({type(error).__name__}).', flush=True)
    feedback_limiter = RateLimiter()
    retention_stop = threading.Event()
    def prune_feedback():
        while not retention_stop.wait(3600):
            try:
                if feedback is not None:
                    feedback.prune()
            except Exception:
                print('Feedback retention cleanup will retry.', flush=True)
    threading.Thread(target=prune_feedback, daemon=True).start()

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
                      "/cache.js": ("cache.js", "text/javascript"),
                      "/map.js": ("map.js", "text/javascript"),
                      "/location.js": ("location.js", "text/javascript"),
                      "/frontage.js": ("frontage.js", "text/javascript"),
                      "/elevation.js": ("elevation.js", "text/javascript"),
                      "/feedback.js": ("feedback.js", "text/javascript"),
                      "/mobile.js": ("mobile.js", "text/javascript"),
                      "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
                      "/icons/icon-192.png": ("icons/icon-192.png", "image/png"),
                      "/icons/icon-512.png": ("icons/icon-512.png", "image/png"),
                      "/icons/apple-touch-icon.png": ("icons/apple-touch-icon.png", "image/png"),
                      "/style.css": ("style.css", "text/css")}
            try:
                if path == "/healthz":
                    self.send_body(b'{"status":"ok"}')
                elif path == '/api/feedback':
                    self.send_body(json.dumps({'available': feedback is not None,
                                               'retentionDays': RETENTION_DAYS}).encode())
                elif path == "/api/data":
                    with lock:
                        body = payload(self.route_id())
                    self.send_body(body)
                elif path == "/api/boarding-stops":
                    self.send_body(json.dumps(cached_boarding_stops(), allow_nan=False).encode())
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
                    departures = route_departures(stop.get("oba_stop_ids", []), route_id)
                    self.send_body(json.dumps(departures).encode())
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
            if urlsplit(self.path).path == '/api/feedback':
                self.submit_feedback()
                return
            if urlsplit(self.path).path != "/api/refresh":
                self.send_error(404)
                return
            # Only the local dashboard can initiate potentially large downloads.
            if (os.environ.get("ROUTE_LENS_HOSTED") == "1"
                    or self.headers.get("X-Route-Explorer") != "1"
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

        def submit_feedback(self):
            if feedback is None:
                self.error('Feedback storage is unavailable. Please try again later.', 503)
                return
            origin = urlsplit(self.headers.get('Origin', ''))
            if (origin.scheme not in ('http', 'https') or origin.netloc != self.headers.get('Host')
                    or self.headers.get('X-Route-Lens-Feedback') != '1'
                    or self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                self.error('Feedback must be sent from this app.', 403)
                return
            client = self.client_address[0]
            if os.environ.get('ROUTE_LENS_HOSTED') == '1':
                client = self.headers.get('X-Forwarded-For', client).split(',')[-1].strip()
            if not feedback_limiter.allow(client):
                self.error('Too many submissions. Please wait ten minutes and retry.', 429)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 24576:
                    self.error('Feedback payload is too large or empty.', 413)
                    return
                receipt = feedback.submit(json.loads(self.rfile.read(size)))
                self.send_body(json.dumps({'id': receipt, 'stored': True}).encode(), status=201)
            except (ValueError, UnicodeDecodeError) as error:
                self.error(str(error))
            except Exception:
                self.error('Feedback could not be saved. Please try again later.', 503)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Route Explorer running at http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        retention_stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
