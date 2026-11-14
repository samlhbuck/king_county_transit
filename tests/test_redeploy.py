import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import redeploy


class RedeployTests(unittest.TestCase):
    def test_json_lines_deployment_id(self):
        self.assertEqual(redeploy.deployment_id(redeploy.json_output(
            '{"message":"uploading"}\n{"deploymentId":"ours"}')), 'ours')
        self.assertIsNone(redeploy.deployment_id({'id': 'unrelated'}))

    def test_waits_for_own_deployment(self):
        calls = []
        replies = iter([
            {'name': 'route-lens', 'services': {'edges': [{'node': {'id': 's', 'name': 'route-lens'}}]}},
            {'deploymentId': 'ours'},
            [{'id': 'other', 'status': 'SUCCESS'}, {'id': 'ours', 'status': 'BUILDING'}],
            [{'id': 'ours', 'status': 'SUCCESS'}],
        ])
        def run(command, **kwargs):
            import json
            from subprocess import CompletedProcess
            calls.append(command)
            return CompletedProcess(command, 0, json.dumps(next(replies)), '')
        with patch.object(sys, 'argv', ['redeploy']), patch.object(redeploy.shutil, 'which', return_value='/bin/railway'), patch.object(redeploy, 'prepare'), patch.object(redeploy.tempfile, 'mkdtemp', return_value='/tmp/mock-release'), patch.object(redeploy.subprocess, 'run', side_effect=run), patch.object(redeploy.time, 'sleep') as sleep:
            redeploy.main()
        sleep.assert_called_once_with(10)
        self.assertEqual(len(calls), 4)
