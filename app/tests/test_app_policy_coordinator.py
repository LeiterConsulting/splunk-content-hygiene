"""Synthetic policy contracts. No Splunk fixture/customer configuration is written."""
import copy
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import test_review_coordinator as existing

coordinator = existing.coordinator
proposed = existing.proposed


def policy(number=1, head=None, state='active', note='Approved retention'):
    app = 'owned_example'
    return {'version': 1, '_key': coordinator.policy_key(app, number), 'app_id': app,
            'app_object_id': 'app::owned_example::owned_example', 'revision_number': number,
            'parent_revision': head['_key'] if head else None, 'state': state, 'note': note,
            'scope': 'shared_exact_app_current_and_future', 'scan_id': 'complete-fixture',
            'app_fingerprint': coordinator.app_scope_fingerprint({'version': 2, 'digest': 'a' * 64, 'accessDigest': 'b' * 64, 'accessComplete': True}), 'request_id': note}


class PolicyBackend(existing.FakeBackend):
    def __init__(self):
        super().__init__()
        self.policies = []
        self.reads = []
        self.fixture = {
            'ch_settings': [{'_key': 'inventory_manifest_v2', 'baseline_scan_id': 'complete-fixture'}],
            'ch_scan_runs': [{'scan_id': 'complete-fixture', 'scan_mode': 'full', 'status': 'partial',
                              'collector_counts': {'apps': 1}, 'collector_totals': {'apps': 1}}],
            'ch_objects': [{'scan_id': 'complete-fixture', 'object_id': 'app::owned_example::owned_example',
                            'object_type': 'App', 'app': 'owned_example', 'name': 'owned_example', 'sharing': 'app',
                            'configuration_fingerprint': {'version': 2, 'digest': 'a' * 64, 'accessDigest': 'b' * 64, 'accessComplete': True}}]}

    def rows(self, collection, query, fields=None):
        self.reads.append(collection)
        rows = self.policies if collection == coordinator.POLICY_COLLECTION else self.fixture.get(collection, [])
        return copy.deepcopy([row for row in rows if all(row.get(key) == value for key, value in query.items())])

    def call(self, path, method='GET', body=None):
        assert method == 'POST' and path == coordinator.KV + coordinator.POLICY_COLLECTION
        self.policies.append(copy.deepcopy(body))
        return {'_key': body['_key']}


class AppPolicyTests(unittest.TestCase):
    def setUp(self):
        existing.ReviewCoordinatorTests.setUp(self)
        self.policy_backend = PolicyBackend()

    def tearDown(self):
        existing.ReviewCoordinatorTests.tearDown(self)

    def save_policy(self, row):
        with coordinator.review_lock():
            return coordinator.commit_policy(self.policy_backend, row, 'authenticated-operator')

    def test_policy_writes_never_read_or_change_review_records(self):
        original = proposed()
        self.backend.journal = [copy.deepcopy(original)]
        self.save_policy(policy())
        self.assertEqual(self.backend.journal, [original])
        self.assertFalse({'ch_reviews', 'ch_review_revisions'} & set(self.policy_backend.reads))
        saved = self.policy_backend.policies[0]
        self.assertEqual(saved['updated_by'], 'authenticated-operator')
        self.assertEqual(saved['created_at'], saved['updated_at'])

    def test_concurrent_policy_creation_is_serialized(self):
        def attempt(index):
            try:
                self.save_policy(policy(note=str(index)))
                return 201
            except coordinator.Rejected as error:
                return error.status
        with ThreadPoolExecutor(max_workers=12) as pool:
            result = list(pool.map(attempt, range(12)))
        self.assertEqual(result.count(201), 1)
        self.assertEqual(result.count(409), 11)
        self.assertEqual(len(self.policy_backend.policies), 1)

    def test_disable_archive_and_restore_append_without_deleting_history(self):
        self.save_policy(policy())
        root = copy.deepcopy(self.policy_backend.policies[0])
        self.policy_backend.fixture['ch_objects'] = []
        self.save_policy(policy(2, root, 'disabled'))
        self.save_policy(policy(3, self.policy_backend.policies[-1], 'archived'))
        self.assertEqual(self.policy_backend.policies[0], root)
        self.assertEqual([row['state'] for row in self.policy_backend.policies], ['active', 'disabled', 'archived'])
        with self.assertRaises(coordinator.Rejected):
            self.save_policy(policy(4, self.policy_backend.policies[-1], 'active'))

    def test_stale_parent_and_reused_request_with_different_content_are_rejected(self):
        first = policy()
        self.save_policy(first)
        self.save_policy(first)
        self.assertEqual(len(self.policy_backend.policies), 1)
        changed = {**first, 'state': 'disabled'}
        with self.assertRaises(coordinator.Rejected):
            self.save_policy(changed)
        head = self.policy_backend.policies[0]
        self.save_policy(policy(2, head, 'disabled', 'First operator'))
        with self.assertRaises(coordinator.Rejected):
            self.save_policy(policy(2, head, 'archived', 'Stale operator'))

    def test_invalid_preview_or_changed_app_never_activates(self):
        for collection, key, value in [('ch_objects', 'app', 'renamed_app'), ('ch_objects', 'sharing', 'user'),
                                        ('ch_scan_runs', 'scan_mode', 'bounded'), ('ch_scan_runs', 'collector_totals', {'apps': 2}),
                                        ('ch_scan_runs', 'collector_counts', {}), ('ch_scan_runs', 'status', 'failed')]:
            original = copy.deepcopy(self.policy_backend.fixture)
            self.policy_backend.fixture[collection][0][key] = value
            with self.assertRaises(coordinator.Rejected):
                self.save_policy(policy())
            self.policy_backend.fixture = original
        self.assertEqual(self.policy_backend.policies, [])

    def test_foreign_identity_parent_extra_fields_and_client_actor_rejected(self):
        for change in [{'app_id': '../other'}, {'app_object_id': 'saved_search::owned_example::other'},
                       {'parent_revision': 'foreign'}, {'updated_by': 'client-claimed-admin'}, {'state': 'delete'},
                       {'scope': 'all_apps'}, {'note': 'x' * 4001}]:
            with self.assertRaises(coordinator.Rejected):
                self.save_policy({**policy(), **change})
        self.assertEqual(self.policy_backend.policies, [])

    def test_js_utf16_limits_boolean_versions_and_capacity_fail_closed(self):
        for change in [{'version': True}, {'note': '😀' * 2001}, {'request_id': '😀' * 65}]:
            with self.assertRaises(coordinator.Rejected):
                self.save_policy({**policy(), **change})
        with patch.object(coordinator, 'POLICY_LIMIT', 1):
            self.save_policy(policy())
            other = {**policy(), 'app_id': 'other_example', 'app_object_id': 'app::other_example::other_example',
                     '_key': coordinator.policy_key('other_example', 1)}
            with self.assertRaises(coordinator.Rejected) as failure:
                self.save_policy(other)
            self.assertEqual(failure.exception.status, 409)
        self.assertEqual(len(self.policy_backend.policies), 1)

    def test_corrupt_duplicate_or_gap_history_fails_closed(self):
        self.save_policy(policy())
        self.policy_backend.policies.append(copy.deepcopy(self.policy_backend.policies[0]))
        with self.assertRaises(coordinator.Rejected):
            self.save_policy(policy(2, self.policy_backend.policies[0]))

    def test_reviewer_cannot_manage_app_wide_policy(self):
        handler = coordinator.ReviewCoordinator()
        with patch.object(coordinator.Backend, 'actor', return_value='reviewer'), \
                patch.object(coordinator.Backend, 'standalone', return_value=True), \
                patch.object(coordinator.Backend, 'policy_actor', side_effect=coordinator.Rejected(403, 'Operator required')):
            result = handler.handle(json.dumps({'session': {'authtoken': 'test'}, 'method': 'POST',
                                               'payload': json.dumps({'kind': 'app_policy', 'proposal': policy()})}))
            self.assertEqual(result['status'], 403)

    def test_role_resolution_checks_operator_not_reviewer_capability(self):
        for roles, allowed in [(['content_hygiene_reviewer'], False), (['content_hygiene_viewer'], False),
                               (['content_hygiene_operator'], True), (['admin'], True)]:
            backend = coordinator.Backend('not-a-real-token')
            with patch.object(backend, 'call', return_value={'entry': [{'content': {'username': 'actor', 'roles': roles}}]}):
                if allowed:
                    self.assertEqual(backend.policy_actor(), 'actor')
                else:
                    with self.assertRaises(coordinator.Rejected):
                        backend.policy_actor()
