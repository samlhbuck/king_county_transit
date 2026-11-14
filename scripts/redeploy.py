"""Upload a fresh Route Lens snapshot to the existing Railway service."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

from prepare_release import prepare, ROOT


def json_output(raw):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return [json.loads(line) for line in raw.splitlines() if line.strip().startswith('{')]


def deployment_id(value):
    if isinstance(value, dict):
        if value.get('deploymentId'):
            return value['deploymentId']
        for child in value.values():
            found = deployment_id(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = deployment_id(child)
            if found:
                return found
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='0b4c9245-f4b6-49eb-b3d3-7d9c9d43fd98')
    parser.add_argument('--service', default='route-lens')
    parser.add_argument('--environment', default='production')
    parser.add_argument('--prepare-only', action='store_true', help='Prepare files without contacting Railway')
    parser.add_argument('--timeout', type=int, default=1200, help='Deployment polling deadline in seconds')
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    cli = shutil.which('railway')
    if not args.prepare_only and not cli:
        raise RuntimeError('Railway CLI missing. Install it and run railway login first.')
    env = {**os.environ, 'RAILWAY_CALLER': 'route-lens-redeploy',
           'RAILWAY_AGENT_SESSION': 'route-lens-' + uuid.uuid4().hex}
    def run(arguments, cwd=ROOT):
        result = subprocess.run([cli, *arguments], cwd=cwd, env=env, text=True,
                                capture_output=True, timeout=300)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'Railway command failed')
        return json_output(result.stdout)

    scope = ['--project', args.project, '--environment', args.environment, '--service', args.service]
    if not args.prepare_only:
        status = run(['status', '--project', args.project, '--environment', args.environment, '--json'])
        services = [edge['node'] for edge in status.get('services', {}).get('edges', [])]
        if not any(args.service in (s['id'], s['name']) for s in services):
            raise RuntimeError('Target service does not exist in this project. Nothing uploaded.')
        print(f"Deploying {status['name']} / {args.environment} / {args.service}", flush=True)
    destination = Path(tempfile.mkdtemp(prefix='route-lens-release-')) / 'app'
    prepare(destination)
    if args.prepare_only:
        return
    print('Uploading saved local files, including uncommitted changes. Git is unchanged.', flush=True)
    upload = run(['up', *scope, '--detach', '--json', '-m', 'Route Lens local snapshot'], destination)
    identifier = deployment_id(upload)
    if not identifier:
        raise RuntimeError('Upload response did not identify a deployment. Check the Railway dashboard before retrying; upload may have succeeded.')
    print(f'Deployment: {identifier}', flush=True)
    print(f'https://railway.com/project/{args.project}', flush=True)
    deadline = time.monotonic() + args.timeout
    previous = None
    while time.monotonic() < deadline:
        deployments = run(['deployment', 'list', *scope, '--limit', '100', '--json'])
        if not isinstance(deployments, list):
            raise RuntimeError('Unexpected deployment list response. Check the dashboard; do not re-upload yet.')
        current = next((d for d in deployments if d.get('id') == identifier), None)
        state = current.get('status') if current else 'AWAITING_LISTING'
        if state != previous:
            print(state, flush=True)
            previous = state
        if state == 'SUCCESS':
            print('Deployed successfully. Reopen the existing app URL on your iPhone.')
            return
        if state not in {'AWAITING_LISTING', 'QUEUED', 'INITIALIZING', 'WAITING', 'BUILDING', 'DEPLOYING'}:
            raise RuntimeError(f'Deployment {identifier}: {state}. Inspect its build/runtime logs in the dashboard.')
        time.sleep(10)
    raise RuntimeError(f'Timed out waiting for {identifier}; it may still be deploying. Check the dashboard before retrying.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped watching. Any uploaded deployment continues on Railway.')
        raise SystemExit(130)
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        print(f'Redeploy stopped: {error}')
        raise SystemExit(1)
