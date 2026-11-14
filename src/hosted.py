"""Prepare the persistent feedback directory, then run the server as routeapp."""
import os
import sys
from src.feedback import database_path

if os.geteuid() == 0:
    os.umask(0o077)
    path = database_path()
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chown(path.parent, 10001, 10001)
        for name in (str(path), str(path) + '-wal', str(path) + '-shm'):
            if os.path.exists(name):
                os.chown(name, 10001, 10001)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
os.execv(sys.executable, [sys.executable, 'app.py'])
