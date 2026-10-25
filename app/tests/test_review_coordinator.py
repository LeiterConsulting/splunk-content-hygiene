"""Standard-library tests; fake KV deliberately does NOT enforce unique keys."""
import copy
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

# The installed Splunk runtime supplies these modules, not a vendored SDK.
for name in ('splunk', 'splunk.rest', 'splunk.clilib', 'splunk.clilib.cli_common',
             'splunk.persistconn', 'splunk.persistconn.application'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['splunk'].rest = sys.modules['splunk.rest']
sys.modules['splunk.clilib'].cli_common = sys.modules['splunk.clilib.cli_common']
sys.modules['splunk.persistconn.application'].PersistentServerConnectionApplication = object
source = Path(__file__).resolve().parents[1] / 'packages/content-hygiene/src/main/resources/splunk/bin/content_hygiene_reviews.py'
spec = importlib.util.spec_from_file_location('coordinator', source)
coordinator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coordinator)


class FakeBackend:
    def __init__(self):
        self.journal = []
        self.legacy = []

    def rows(self, collection, query, fields=None):
        rows = self.legacy if collection == 'ch_reviews' else self.journal
        return copy.deepcopy([row for row in rows if all(
            row.get(key) in value['$in'] if isinstance(value, dict) else row.get(key) == value
            for key, value in query.items())])

    def call(self, path, method='GET', body=None):
        assert path == coordinator.KV + 'ch_review_revisions' and method == 'POST'
        time.sleep(0.015)  # Expose check/insert races without a coordinator.
        self.journal.append(copy.deepcopy(body))
        return {'_key': body['_key']}


def proposed(number=1, note='Decision', head=None, legacy=None):
    object_id = 'app::content_hygiene::content_hygiene'
    key = coordinator.revision_key(object_id, number)
    record = copy.deepcopy((head or {}).get('record') or legacy or {
        'object_id': object_id, 'stage': 'investigating', 'note': note,
        'assigned_to': None, 'scan_id': 'scan-live', 'created_at': '2026-01-01T00:00:00Z',
        'updated_at': '2026-01-01T00:00:00Z', 'updated_by': 'client-claim'})
    record.pop('_key', None)
    record['note'] = note
    origin = (head or {}).get('origin_digest') or ('legacy-r1-' + 'a' * 64 if legacy else None)
    return {'version': 1, '_key': key, 'object_id': object_id, 'revision_number': number,
            'parent_revision': head['_key'] if head else origin, 'origin_digest': origin,
            'operation': 'save', 'request_id': note, 'record': record,
            'baseline_ref': (head or {}).get('baseline_ref'), 'history_refs': (head or {}).get('history_refs', []),
            **({'origin_record': copy.deepcopy(legacy)} if legacy and not head else {})}


def lock_process(folder, results):
    os.environ['SPLUNK_HOME'] = folder
    with coordinator.review_lock():
        results.put(('start', time.monotonic()))
        time.sleep(0.06)
        results.put(('end', time.monotonic()))


class ReviewCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.backend = FakeBackend()
        self.folder = tempfile.TemporaryDirectory(prefix='ch-review-test-')
        self.environment = patch.dict(os.environ, {'SPLUNK_HOME': self.folder.name})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.folder.cleanup()

    def commit(self, row):
        with coordinator.review_lock():
            return coordinator.commit_revision(self.backend, row, 'authenticated-reviewer')

    def test_race_serializes_even_when_kv_accepts_duplicates(self):
        def attempt(label):
            try:
                self.commit(proposed(note=label))
                return 201
            except coordinator.Rejected as error:
                return error.status
        with ThreadPoolExecutor(max_workers=12) as pool:
            statuses = list(pool.map(attempt, [str(i) for i in range(12)]))
        self.assertEqual(statuses.count(201), 1)
        self.assertEqual(statuses.count(409), 11)
        self.assertEqual(len(self.backend.journal), 1)

    def test_lock_serializes_independent_processes(self):
        context = multiprocessing.get_context('fork')
        results = context.Queue()
        processes = [context.Process(target=lock_process, args=(self.folder.name, results)) for _ in range(3)]
        for process in processes:
            process.start()
        events = sorted([results.get(timeout=5) for _ in range(6)], key=lambda item: item[1])
        for process in processes:
            process.join(timeout=5)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual([item[0] for item in events], ['start', 'end'] * 3)

    def test_server_records_actor_time_and_repeated_request_does_not_reinsert(self):
        row = proposed()
        self.commit(row)
        self.commit(row)
        self.assertEqual(len(self.backend.journal), 1)
        saved = self.backend.journal[0]
        self.assertEqual(saved['record']['updated_by'], 'authenticated-reviewer')
        self.assertEqual(saved['updated_by'], 'authenticated-reviewer')
        self.assertNotEqual(saved['record']['created_at'], row['record']['created_at'])

    def test_stale_parent_rejected_without_overwrite(self):
        self.commit(proposed())
        self.commit(proposed(2, 'Second', self.backend.journal[0]))
        with self.assertRaises(coordinator.Rejected) as failure:
            self.commit(proposed(2, 'Stale', self.backend.journal[0]))
        self.assertEqual(failure.exception.status, 409)
        self.assertEqual(len(self.backend.journal), 2)

    def test_legacy_decision_preserved_and_outside_edit_blocks(self):
        legacy = proposed()['record']
        legacy['_key'] = 'original'
        self.backend.legacy = [copy.deepcopy(legacy)]
        self.commit(proposed(legacy=legacy))
        self.assertEqual(self.backend.legacy, [legacy])
        self.backend.legacy[0]['note'] = 'Outside edit'
        with self.assertRaises(coordinator.Rejected):
            self.commit(proposed(2, 'Second', self.backend.journal[0]))

    def test_archive_preserves_decision_and_restore_appends(self):
        self.commit(proposed())
        archived = proposed(2, head=self.backend.journal[-1])
        archived['operation'] = 'remove'
        self.commit(archived)
        self.commit(proposed(3, head=self.backend.journal[-1]))
        self.assertEqual([row['operation'] for row in self.backend.journal], ['save', 'remove', 'save'])

    def test_reaffirm_cannot_change_note_or_references(self):
        self.commit(proposed())
        changed = proposed(2, 'Changed', self.backend.journal[0])
        changed['capture'] = {'evidence': {'objectId': changed['object_id'], 'version': 2, 'scanId': 'live'}}
        with self.assertRaises(coordinator.Rejected):
            self.commit(changed)
        changed.pop('capture')
        changed['baseline_ref'] = {'revision': changed['_key'], 'number': 2, 'slot': 'capture'}
        with self.assertRaises(coordinator.Rejected):
            self.commit(changed)

    def test_duplicate_or_missing_history_fails_closed(self):
        self.commit(proposed())
        self.backend.journal.append(copy.deepcopy(self.backend.journal[0]))
        with self.assertRaises(coordinator.Rejected):
            self.commit(proposed(2, head=self.backend.journal[0]))
        self.assertEqual(len(self.backend.journal), 2)

    def test_cannot_change_original_facts_or_write_arbitrary_collection(self):
        self.commit(proposed())
        changed = proposed(2, head=self.backend.journal[0])
        changed['record']['scan_id'] = 'rewritten'
        with self.assertRaises(coordinator.Rejected):
            self.commit(changed)
        with self.assertRaises(coordinator.Rejected):
            coordinator.Backend('not-a-real-token').call('/services/saved/searches', 'POST', {})

    def test_handler_rejects_viewer_cluster_and_malformed_body(self):
        handler = coordinator.ReviewCoordinator()
        with patch.object(coordinator.Backend, 'actor', side_effect=coordinator.Rejected(403, 'Denied')):
            self.assertEqual(handler.handle(json.dumps({'session': {'authtoken': 'test'}}))['status'], 403)
        with patch.object(coordinator.Backend, 'actor', return_value='reviewer'), patch.object(coordinator.Backend, 'standalone', return_value=False):
            self.assertEqual(handler.handle(json.dumps({'session': {'authtoken': 'test'}}))['status'], 503)
        with patch.object(coordinator.Backend, 'actor', return_value='reviewer'), patch.object(coordinator.Backend, 'standalone', return_value=True):
            request = {'session': {'authtoken': 'test'}, 'method': 'POST', 'payload': 'not json'}
            self.assertEqual(handler.handle(json.dumps(request))['status'], 400)
            request['method'] = 'DELETE'
            self.assertEqual(handler.handle(json.dumps(request))['status'], 405)
        self.assertEqual(handler.handle(json.dumps({'method': 'POST'}))['status'], 401)

    def test_packaged_request_limit_has_an_explicit_binary_unit(self):
        config = source.parent.parent / 'default/restmap.conf'
        setting = [line.strip() for line in config.read_text().splitlines()
                   if line.startswith('max_content_length')]
        self.assertEqual(setting, ['max_content_length = 4 MiB'])

    def test_payload_boundary_counts_utf8_bytes_and_never_commits_oversize(self):
        handler = coordinator.ReviewCoordinator()
        limit = 4 * 1024 * 1024
        valid = json.dumps(proposed())
        with patch.object(coordinator.Backend, 'actor', return_value='reviewer'), \
                patch.object(coordinator.Backend, 'standalone', return_value=True), \
                patch.object(coordinator, 'commit_revision', return_value={'accepted': True}) as commit:
            for size in (limit - 1, limit):
                payload = valid + ' ' * (size - len(valid.encode('utf-8')))
                result = handler.handle(json.dumps({'session': {'authtoken': 'test'},
                                                   'method': 'POST', 'payload': payload}))
                self.assertEqual(result['status'], 201)
            self.assertEqual(commit.call_count, 2)
            commit.reset_mock()
            for payload in (valid + ' ' * (limit + 1 - len(valid)),
                            '{"padding":"' + 'é' * (limit // 2) + '"}'):
                self.assertGreater(len(payload.encode('utf-8')), limit)
                result = handler.handle(json.dumps({'session': {'authtoken': 'test'},
                                                   'method': 'POST', 'payload': payload}))
                self.assertEqual(result['status'], 400)
                self.assertIn('too large', result['payload']['messages'][0]['text'])
            commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
