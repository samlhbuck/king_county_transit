import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from src.feedback import FeedbackStore, RateLimiter, validate, database_path, RETENTION_DAYS


class FeedbackTests(unittest.TestCase):
    def test_receipt_retry_does_not_duplicate_committed_feedback(self):
        with tempfile.TemporaryDirectory() as folder:
            store=FeedbackStore(Path(folder)/'queue.sqlite3')
            payload={'category':'bug','text':'Retry test','submissionId':'a'*32}
            self.assertEqual(store.submit(payload),store.submit(payload))
            self.assertEqual(len(store.read()),1)
            payload['text']='Changed'
            with self.assertRaises(ValueError):store.submit(payload)
    def test_committed_feedback_survives_new_store_and_keeps_context_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'queue.sqlite3'
            identifier=FeedbackStore(path).submit({'category':'bug','text':'The slider stuck',
                                                  'context':{'routeId':'route','lens':'Elevation'}})
            rows=FeedbackStore(path).read()
            self.assertEqual(rows[0]['id'],identifier)
            self.assertEqual(rows[0]['context'],{'routeId':'route','lens':'Elevation'})
            self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_optional_text_and_context_do_not_require_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            store=FeedbackStore(Path(folder)/'queue.sqlite3')
            store.submit({'category':'interesting'})
            row=store.read()[0]
            self.assertEqual(row['text'],'')
            self.assertEqual(row['context'],{})
            self.assertNotIn('ip',row)

    def test_validation_and_honeypot_reject_without_storage(self):
        for payload in [[], {'category':[]}, {'category':'unknown'},
                        {'category':'bug','text':'x'*4001},
                        {'category':'bug','context':{'latitude':47}},
                        {'category':'bug','website':'spam'},
                        {'category':'bug','context':{'stopId':1}}]:
            with self.assertRaises(ValueError):validate(payload)

    def test_rate_limit_expires_and_does_not_keep_ip_addresses(self):
        limiter=RateLimiter()
        self.assertTrue(all(limiter.allow('client-ip',now=1) for _ in range(5)))
        self.assertFalse(limiter.allow('client-ip',now=2))
        self.assertNotIn('client-ip',json.dumps(list(limiter.clients)))
        self.assertTrue(limiter.allow('client-ip',now=602))

    def test_retention_deletes_old_rows_but_preserves_recent_feedback(self):
        with tempfile.TemporaryDirectory() as folder:
            store=FeedbackStore(Path(folder)/'queue.sqlite3')
            with patch('src.feedback.time.time',return_value=1):
                old=store.submit({'category':'bug'})
            recent=store.submit({'category':'other'})
            self.assertEqual([r['id'] for r in store.read()],[recent])

    def test_hosted_storage_requires_explicit_durable_configuration(self):
        with patch.dict('os.environ',{'ROUTE_LENS_HOSTED':'1'},clear=True):
            self.assertIsNone(database_path())
        with patch.dict('os.environ',{'ROUTE_LENS_HOSTED':'1','RAILWAY_VOLUME_MOUNT_PATH':'/feedback'},clear=True):
            self.assertEqual(database_path(),Path('/feedback/feedback.sqlite3'))
