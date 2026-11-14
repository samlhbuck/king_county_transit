"""Private, durable product-feedback queue. No public retrieval endpoint."""
import argparse
from collections import OrderedDict
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
import uuid

RETENTION_DAYS = 90
CATEGORIES = ('confusing-interface', 'bug', 'missing-information', 'interesting', 'other')
CONTEXT_FIELDS = {'routeId', 'routeName', 'stopId', 'stopName', 'lens'}


def database_path():
    if os.environ.get('FEEDBACK_DB_PATH'):
        return Path(os.environ['FEEDBACK_DB_PATH'])
    if os.environ.get('RAILWAY_VOLUME_MOUNT_PATH') == '/feedback':
        return Path('/feedback/feedback.sqlite3')
    if os.environ.get('ROUTE_LENS_HOSTED') == '1':
        return None
    return Path(__file__).resolve().parents[1] / 'var/feedback.sqlite3'


def validate(payload):
    if not isinstance(payload, dict) or set(payload) - {'category', 'text', 'context', 'website', 'submissionId'}:
        raise ValueError('Invalid feedback payload.')
    if payload.get('website'):
        raise ValueError('Unable to accept this submission.')
    category = payload.get('category')
    if not isinstance(category, str) or category not in CATEGORIES:
        raise ValueError('Choose a feedback category.')
    text = payload.get('text', '')
    if not isinstance(text, str) or len(text) > 4000:
        raise ValueError('Feedback must be at most 4,000 characters.')
    context = payload.get('context', {})
    if not isinstance(context, dict) or set(context) - CONTEXT_FIELDS:
        raise ValueError('Invalid feedback context.')
    for value in context.values():
        if not isinstance(value, str) or len(value) > 200:
            raise ValueError('Invalid feedback context.')
    identifier = payload.get('submissionId')
    if identifier is not None:
        if not isinstance(identifier, str) or len(identifier) != 32:
            raise ValueError('Invalid submission receipt.')
        try:
            uuid.UUID(hex=identifier)
        except ValueError:
            raise ValueError('Invalid submission receipt.')
    return category, text.strip(), context


class RateLimiter:
    """Five attempts per ten minutes; ephemeral hashes, never stored client IPs."""
    def __init__(self):
        self.secret = secrets.token_bytes(32)
        self.clients = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, client, now=None):
        now = time.monotonic() if now is None else now
        key = hmac.new(self.secret, client.encode(), hashlib.sha256).hexdigest()
        with self.lock:
            while self.clients and next(iter(self.clients.values()))[0] <= now - 600:
                self.clients.popitem(last=False)
            start, count = self.clients.get(key, (now, 0))
            if count >= 5:
                return False
            if key not in self.clients and len(self.clients) >= 4096:
                return False
            self.clients[key] = (start, count + 1)
            return True


class FeedbackStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS feedback '
                       '(id TEXT PRIMARY KEY, created REAL NOT NULL, category TEXT NOT NULL, '
                       'text TEXT NOT NULL, context TEXT NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created)')
        self.path.chmod(0o600)
        self.prune()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def prune(self, now=None):
        cutoff = (time.time() if now is None else now) - RETENTION_DAYS * 86400
        with self.connect() as db:
            db.execute('DELETE FROM feedback WHERE created < ?', (cutoff,))

    def submit(self, payload):
        category, text, context = validate(payload)
        identifier = payload.get('submissionId') or uuid.uuid4().hex
        now = time.time()
        with self.connect() as db:
            db.execute('DELETE FROM feedback WHERE created < ?', (now - RETENTION_DAYS * 86400,))
            existing = db.execute('SELECT category, text, context FROM feedback WHERE id = ?', (identifier,)).fetchone()
            if existing:
                if existing != (category, text, json.dumps(context)):
                    raise ValueError('This receipt belongs to different feedback. Reopen the form and retry.')
                return identifier
            if db.execute('SELECT COUNT(*) FROM feedback').fetchone()[0] >= 10000:
                raise RuntimeError('The feedback queue is full. Please try again later.')
            db.execute('INSERT INTO feedback VALUES (?, ?, ?, ?, ?)',
                       (identifier, now, category, text, json.dumps(context)))
        # A receipt is returned only after SQLite commits successfully.
        return identifier

    def read(self, limit=50):
        self.prune()
        with self.connect() as db:
            rows = db.execute('SELECT id, created, category, text, context FROM feedback '
                              'ORDER BY created DESC LIMIT ?', (limit,)).fetchall()
        return [{'id': row[0], 'created': row[1], 'category': row[2], 'text': row[3],
                 'context': json.loads(row[4])} for row in rows]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['list', 'prune'])
    parser.add_argument('--database', type=Path, default=database_path())
    parser.add_argument('--limit', type=int, default=50)
    args = parser.parse_args()
    if args.database is None:
        parser.error('Feedback storage is not configured.')
    if not 1 <= args.limit <= 10000:
        parser.error('--limit must be between 1 and 10000')
    # Railway SSH runs as the image user; preserve app ownership of WAL files.
    if os.geteuid() == 0 and args.database.exists():
        owner = args.database.stat()
        os.setgroups([])
        os.setgid(owner.st_gid)
        os.setuid(owner.st_uid)
    store = FeedbackStore(args.database)
    if args.action == 'list':
        print(json.dumps(store.read(args.limit), indent=2))
    else:
        store.prune()
