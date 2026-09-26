"""Sourced service opening dates, separate from transit cache retrieval dates."""
from datetime import date
import json
from pathlib import Path

HISTORY_FILE = Path(__file__).resolve().parents[1] / 'data/reference/route_history.json'


def load_route_history(route_id):
    if not HISTORY_FILE.exists():
        return None
    history = json.loads(HISTORY_FILE.read_text(encoding='utf-8')).get(route_id)
    if history:
        date.fromisoformat(history['service_start_date'])
    return history
