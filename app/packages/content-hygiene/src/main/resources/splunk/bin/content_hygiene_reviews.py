"""Serialize separate app-local review and app-policy revision journals.

No customer-content endpoint, arbitrary path, subprocess, or system token is used.
The caller's existing session/collection permissions remain authoritative.
"""
import copy
import datetime
import hashlib
import json
import os
import re
import time
from contextlib import contextmanager
from urllib.parse import urlencode

from splunk import rest
from splunk.clilib import cli_common
from splunk.persistconn.application import PersistentServerConnectionApplication

KV = '/servicesNS/nobody/content_hygiene/storage/collections/data/'
ROLES = {'admin', 'sc_admin', 'content_hygiene_reviewer', 'content_hygiene_operator'}
POLICY_ROLES = {'admin', 'sc_admin', 'content_hygiene_operator'}
POLICY_COLLECTION = 'ch_app_policy_revisions'
POLICY_LIMIT = 10000
STAGES = {'triage', 'investigating', 'awaiting_owner', 'confirmed_eligible', 'retain', 'blocked'}
HEADERS = '_key,version,object_id,revision_number,parent_revision,origin_digest,operation,request_id'


class Rejected(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def revision_key(object_id, number):
    value = json.dumps([object_id, number], ensure_ascii=False, separators=(',', ':'))
    return 'review-r1-' + hashlib.sha256(value.encode('utf-8')).hexdigest()


@contextmanager
def review_lock(timeout=5):
    # flock releases on process death. Never use a stale-timeout lock directory.
    try:
        import fcntl
    except ImportError:
        raise Rejected(503, 'Review coordination requires a standalone POSIX search head.')
    folder = os.path.join(os.environ['SPLUNK_HOME'], 'var', 'run', 'splunk', 'content_hygiene')
    os.makedirs(folder, mode=0o700, exist_ok=True)
    descriptor = os.open(os.path.join(folder, 'reviews.lock'),
                         os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    acquired = False
    try:
        deadline = time.monotonic() + timeout
        while not acquired:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Rejected(503, 'Another app-local save is busy. Reload the saved history before retrying.')
                time.sleep(0.05)
        yield
    finally:
        if acquired:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


class Backend:
    def __init__(self, token):
        self.token = token

    def call(self, path, method='GET', body=None):
        # All write destinations are fixed here, never supplied by the caller.
        if method != 'GET' and (method != 'POST' or path not in (KV + 'ch_review_revisions', KV + POLICY_COLLECTION)):
            raise Rejected(400, 'Unsupported review write destination.')
        response, data = rest.simpleRequest(path, sessionKey=self.token, method=method,
                                            jsonargs=json.dumps(body) if body is not None else None,
                                            rawResult=True, timeout=10)
        status = int(response.status)
        if status >= 400:
            raise Rejected(status if status in (401, 403, 409) else 503,
                           'Review storage rejected the request. Check KV health and hygiene permissions.')
        return json.loads(data)

    def rows(self, collection, query, fields=None):
        if collection not in ('ch_reviews', 'ch_review_revisions', POLICY_COLLECTION, 'ch_settings', 'ch_objects', 'ch_scan_runs'):
            raise Rejected(400, 'Unsupported review collection.')
        rows = []
        while True:
            params = {'query': json.dumps(query), 'limit': 1000, 'skip': len(rows), 'sort': '_key:1'}
            if fields:
                params['fields'] = fields
            batch = self.call(KV + collection + '?' + urlencode(params))
            rows.extend(batch)
            if collection == POLICY_COLLECTION and len(rows) > POLICY_LIMIT:
                raise Rejected(409, 'App policy journal capacity reached. Preserve and export its history.')
            if len(batch) < 1000:
                return rows

    def actor(self):
        value = self.call('/services/authentication/current-context?output_mode=json')['entry'][0]['content']
        if not ROLES.intersection(value.get('roles', [])) or not value.get('username'):
            raise Rejected(403, 'A Content Hygiene reviewer or operator role is required.')
        return value['username']

    def standalone(self):
        stanza = cli_common.getConfStanza('server', 'shclustering')
        return os.name == 'posix' and str(stanza.get('disabled', 'true')).lower() in ('true', '1', 'yes')

    def policy_actor(self):
        value = self.call('/services/authentication/current-context?output_mode=json')['entry'][0]['content']
        if not POLICY_ROLES.intersection(value.get('roles', [])) or not value.get('username'):
            raise Rejected(403, 'A Content Hygiene operator role is required for app-wide retention policies.')
        return value['username']


def validate_revision(row):
    if not isinstance(row, dict):
        raise Rejected(400, 'A review revision object is required.')
    object_id = row.get('object_id')
    number = row.get('revision_number')
    if (not isinstance(object_id, str) or not object_id or len(object_id) > 4096 or
            object_id.startswith(('report::', 'alert::')) or type(number) is not int or number < 1 or
            row.get('version') != 1 or row.get('_key') != revision_key(object_id, number) or
            row.get('operation') not in ('save', 'remove') or
            not isinstance(row.get('request_id'), str) or not 1 <= len(row['request_id']) <= 128):
        raise Rejected(400, 'Invalid review revision identity.')
    origin = row.get('origin_digest')
    parent = origin if number == 1 else revision_key(object_id, number - 1)
    if (row.get('parent_revision') != parent or
            (origin is not None and (not isinstance(origin, str) or not re.fullmatch(r'legacy-r1-[a-f0-9]{64}', origin)))):
        raise Rejected(400, 'Invalid review revision parent.')
    record = row.get('record')
    if (not isinstance(record, dict) or record.get('object_id') != object_id or
            record.get('stage') not in STAGES or not isinstance(record.get('note'), str) or
            len(record['note']) > 4000 or
            (record.get('assigned_to') is not None and
             (not isinstance(record['assigned_to'], str) or len(record['assigned_to']) > 256))):
        raise Rejected(400, 'Invalid review decision fields.')
    refs = [row.get('baseline_ref')] + row.get('history_refs', []) if isinstance(row.get('history_refs'), list) else []
    if not refs or len(refs) > 6:
        raise Rejected(400, 'Invalid retained evidence references.')
    for ref in refs:
        if ref is None:
            continue
        if (not isinstance(ref, dict) or type(ref.get('number')) is not int or
                not 1 <= ref['number'] <= number or ref.get('revision') != revision_key(object_id, ref['number']) or
                ref.get('slot') not in ('capture', 'origin', 'history') or
                (ref.get('slot') == 'history' and (type(ref.get('index')) is not int or ref['index'] < 0))):
            raise Rejected(400, 'Evidence reference is outside this review lineage.')


def commit_revision(backend, proposed, actor):
    """Called while holding the interprocess lock; checks then inserts, never updates."""
    validate_revision(proposed)
    row = copy.deepcopy(proposed)
    object_id = row['object_id']
    headers = backend.rows('ch_review_revisions', {'object_id': object_id}, HEADERS)
    headers.sort(key=lambda item: item.get('revision_number', 0))
    for index, header in enumerate(headers):
        number = index + 1
        if (header.get('version') != 1 or header.get('revision_number') != number or
                header.get('_key') != revision_key(object_id, number) or
                header.get('origin_digest') != headers[0].get('origin_digest') or
                header.get('parent_revision') != (header.get('origin_digest') if number == 1 else revision_key(object_id, number - 1))):
            raise Rejected(409, 'Review history is inconsistent. Preserve the journal and restore a consistent backup.')
    aliases = [object_id]
    if object_id.startswith('saved_search::'):
        aliases += [object_id.replace('saved_search::', family, 1) for family in ('report::', 'alert::')]
    legacy_rows = backend.rows('ch_reviews', {'object_id': {'$in': aliases}})
    if len(legacy_rows) > 1:
        raise Rejected(409, 'Multiple original decisions match this identity. Reconcile them before editing.')
    legacy = legacy_rows[0] if legacy_rows else None
    head = None
    if headers:
        root = backend.rows('ch_review_revisions', {'_key': headers[0]['_key']})[0]
        if root.get('origin_record') != legacy:
            raise Rejected(409, 'The original legacy decision changed outside this history. Both versions are preserved.')
        head = backend.rows('ch_review_revisions', {'_key': headers[-1]['_key']})[0]
        # A repeated accepted request is safe to identify, not to reinsert.
        if head.get('_key') == row['_key'] and head.get('request_id') == row['request_id']:
            return {'_key': head['_key']}
    if row['revision_number'] != len(headers) + 1 or row['parent_revision'] != (head['_key'] if head else row['origin_digest']):
        raise Rejected(409, 'Another reviewer saved first. Compare your draft with the latest saved review.')
    if (head and row['origin_digest'] != head.get('origin_digest')) or (
            not head and (row.get('origin_record') != legacy or (legacy is None) != (row['origin_digest'] is None))):
        raise Rejected(409, 'The original review no longer matches the loaded decision.')
    base = head['record'] if head else legacy
    editable = {'stage', 'note', 'assigned_to', 'updated_at', 'updated_by', '_key', '_user', 'evidence_baseline', 'evidence_history'}
    if base:
        original_facts = {key: value for key, value in base.items() if key not in editable}
        # Legacy Report/Alert display families share one saved-search identity.
        original_facts['object_id'] = object_id
        if any(row['record'].get(key) != value for key, value in original_facts.items()):
            raise Rejected(400, 'Original review facts must be preserved.')
        if head and set(original_facts) != {key for key in row['record'] if key not in editable}:
            raise Rejected(400, 'Original review facts must be preserved.')
    capture = row.get('capture')
    if capture is not None:
        evidence = capture.get('evidence', {}) if isinstance(capture, dict) else {}
        if evidence.get('objectId') != object_id or evidence.get('version') not in (1, 2) or not evidence.get('scanId'):
            raise Rejected(400, 'A supported evidence capture for this object is required.')
        if base and any(row['record'].get(key) != base.get(key) for key in ('stage', 'note', 'assigned_to')):
            raise Rejected(400, 'Save decision edits before reaffirming evidence.')
    if row['operation'] == 'remove' and (not base or capture is not None or any(
            row['record'].get(key) != base.get(key) for key in ('stage', 'note', 'assigned_to'))):
        raise Rejected(400, 'Archiving must preserve the saved decision.')
    baseline = head.get('baseline_ref') if head else ({'revision': row['_key'], 'number': 1, 'slot': 'origin'} if legacy and legacy.get('evidence_baseline') else None)
    history = list(head.get('history_refs', [])) if head else [
        {'revision': row['_key'], 'number': 1, 'slot': 'history', 'index': index}
        for index, _ in enumerate((legacy or {}).get('evidence_history', []))]
    if capture is not None:
        if baseline:
            history.append(baseline)
        baseline = {'revision': row['_key'], 'number': row['revision_number'], 'slot': 'capture'}
    if len(history) > 5:
        history = [history[0]] + history[-4:]
    if row.get('baseline_ref') != baseline or row.get('history_refs') != history:
        raise Rejected(400, 'Evidence references must preserve the accepted history.')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    row['updated_at'] = row['record']['updated_at'] = now
    row['updated_by'] = row['record']['updated_by'] = actor
    if not base:
        row['record']['created_at'] = now
    if capture is not None:
        capture['capturedAt'] = now
        capture['capturedBy'] = actor
    row.pop('_user', None)
    return backend.call(KV + 'ch_review_revisions', 'POST', row)


def policy_key(app, number):
    value = json.dumps([app, number], ensure_ascii=False, separators=(',', ':'))
    return 'app-policy-r1-' + hashlib.sha256(value.encode('utf-8')).hexdigest()


def app_scope_fingerprint(fingerprint):
    if (not isinstance(fingerprint, dict) or fingerprint.get('version') != 2 or
            fingerprint.get('accessComplete') is not True or any(
                not isinstance(fingerprint.get(key), str) or not re.fullmatch(r'[a-f0-9]{64}', fingerprint[key])
                for key in ('digest', 'accessDigest'))):
        return None
    value = json.dumps({'configuration': fingerprint['digest'], 'access': fingerprint['accessDigest']},
                       sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def validate_policy(row, stored=False):
    fields = {'version', '_key', 'app_id', 'app_object_id', 'revision_number', 'parent_revision',
              'state', 'note', 'scope', 'scan_id', 'app_fingerprint', 'request_id'}
    if stored:
        fields |= {'created_at', 'updated_at', 'updated_by', '_user'}
    if not isinstance(row, dict) or set(row) - fields:
        raise Rejected(400, 'Invalid app policy fields.')
    app, number = row.get('app_id'), row.get('revision_number')
    if (not isinstance(app, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,255}', app) or
            type(number) is not int or not 1 <= number <= POLICY_LIMIT or type(row.get('version')) is not int or row.get('version') != 1 or
            row.get('_key') != policy_key(app, number) or row.get('app_object_id') != 'app::' + app + '::' + app or
            row.get('parent_revision') != (None if number == 1 else policy_key(app, number - 1)) or
            row.get('state') not in ('active', 'disabled', 'archived') or
            row.get('scope') != 'shared_exact_app_current_and_future' or
            not isinstance(row.get('note'), str) or len(row['note'].encode('utf-16-le')) // 2 > 4000 or
            not isinstance(row.get('scan_id'), str) or not 1 <= len(row['scan_id']) <= 256 or
            not isinstance(row.get('app_fingerprint'), str) or not re.fullmatch(r'[a-f0-9]{64}', row['app_fingerprint']) or
            not isinstance(row.get('request_id'), str) or not 1 <= len(row['request_id'].encode('utf-16-le')) // 2 <= 128):
        raise Rejected(400, 'Invalid exact-app policy identity or revision.')
    if stored:
        try:
            created = datetime.datetime.fromisoformat(row['created_at'].replace('Z', '+00:00'))
            updated = datetime.datetime.fromisoformat(row['updated_at'].replace('Z', '+00:00'))
            if (not created.tzinfo or not updated.tzinfo or updated < created or
                    not isinstance(row.get('updated_by'), str) or not 1 <= len(row['updated_by'].encode('utf-16-le')) // 2 <= 256):
                raise ValueError()
        except (ValueError, TypeError, KeyError, AttributeError):
            raise Rejected(409, 'App policy audit history cannot be verified. Preserve the journal.')


def commit_policy(backend, proposed, actor):
    """Independent append-only policy history; never reads/writes review decisions."""
    validate_policy(proposed)
    row = copy.deepcopy(proposed)
    history = backend.rows(POLICY_COLLECTION, {'app_id': row['app_id']})
    history.sort(key=lambda item: item.get('revision_number', 0))
    for index, item in enumerate(history):
        validate_policy(item, stored=True)
        if (item['revision_number'] != index + 1 or item['created_at'] != history[0]['created_at'] or
                index > 0 and item['updated_at'] < history[index - 1]['updated_at']):
            raise Rejected(409, 'App policy history is inconsistent. Preserve the journal.')
    head = history[-1] if history else None
    if head and head['_key'] == row['_key'] and head['request_id'] == row['request_id']:
        if any(head.get(key) != value for key, value in row.items()):
            raise Rejected(409, 'This policy request identity was already used for different content.')
        return {'_key': head['_key']}
    if row['revision_number'] != len(history) + 1 or row['parent_revision'] != (head['_key'] if head else None):
        raise Rejected(409, 'Another operator saved first. Reload policy history and compare your draft.')
    if len(backend.rows(POLICY_COLLECTION, {}, '_key')) >= POLICY_LIMIT:
        raise Rejected(409, 'App policy journal capacity reached. Preserve and export its history.')
    if row['state'] == 'active':
        manifests = backend.rows('ch_settings', {'_key': 'inventory_manifest_v2'})
        manifest = manifests[0] if len(manifests) == 1 else {}
        current_scan = manifest.get('baseline_scan_id') or manifest.get('latest_scan_id')
        scans = backend.rows('ch_scan_runs', {'scan_id': current_scan}) if current_scan else []
        scan = scans[0] if len(scans) == 1 else {}
        apps = backend.rows('ch_objects', {'scan_id': current_scan, 'object_id': row['app_object_id']}) if current_scan else []
        app = apps[0] if len(apps) == 1 else {}
        fingerprint = app.get('configuration_fingerprint') or app.get('review_evidence', {}).get('configuration', {})
        app_count = scan.get('collector_counts', {}).get('apps')
        if (row['scan_id'] != current_scan or scan.get('scan_mode') != 'full' or
                scan.get('status') not in ('succeeded', 'partial') or
                type(app_count) is not int or app_count < 1 or app_count != scan.get('collector_totals', {}).get('apps') or
                app.get('object_type') != 'App' or app.get('app') != row['app_id'] or app.get('name') != row['app_id'] or
                app.get('sharing') not in ('app', 'global') or app_scope_fingerprint(fingerprint) != row['app_fingerprint']):
            raise Rejected(409, 'The exact app scope or preview scan changed or is incomplete. Run a complete scan, reload and confirm the current scope.')
    elif not head or any(row[key] != head[key] for key in ('scan_id', 'app_fingerprint')):
        raise Rejected(400, 'Disabling or archiving must preserve the saved policy scope, including missing apps.')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    row['created_at'] = head['created_at'] if head else now
    row['updated_at'], row['updated_by'] = now, actor
    return backend.call(KV + POLICY_COLLECTION, 'POST', row)


class ReviewCoordinator(PersistentServerConnectionApplication):
    def __init__(self, command_line=None, command_arg=None):
        super().__init__()

    def handle(self, in_string):
        try:
            request = json.loads(in_string)
            token = request.get('session', {}).get('authtoken')
            if not token:
                raise Rejected(401, 'An authenticated Splunk session is required.')
            backend = Backend(token)
            actor = backend.actor()
            if not backend.standalone():
                raise Rejected(503, 'Review coordination is supported on standalone search heads, not search-head clusters.')
            method = request.get('method', '').upper()
            if method == 'GET':
                return {'status': 200, 'payload': {'coordinator': 1, 'standalone': True, 'app_policies': 1}}
            if method != 'POST':
                raise Rejected(405, 'Only GET readiness and POST review revisions are supported.')
            payload = request.get('payload', '')
            if not isinstance(payload, str) or len(payload.encode('utf-8')) > 4 * 1024 * 1024:
                raise Rejected(400, 'Review payload is missing or too large.')
            proposed = json.loads(payload)
            if isinstance(proposed, dict) and proposed.get('kind') == 'app_policy':
                actor = backend.policy_actor()
                with review_lock():
                    result = commit_policy(backend, proposed.get('proposal'), actor)
                return {'status': 201, 'payload': result}
            validate_revision(proposed)
            with review_lock():
                result = commit_revision(backend, proposed, actor)
            return {'status': 201, 'payload': result}
        except Rejected as error:
            return {'status': error.status, 'payload': {'messages': [{'type': 'ERROR', 'text': str(error)}]}}
        except (ValueError, TypeError, KeyError):
            return {'status': 400, 'payload': {'messages': [{'type': 'ERROR', 'text': 'Invalid review request or stored review shape. No decision was replaced.'}]}}
        except Exception:
            # Never return/log tokens, request payloads, raw content, or exception strings.
            return {'status': 503, 'payload': {'messages': [{'type': 'ERROR', 'text': 'Review coordinator is unavailable. Verify installation, KV health and app runtime permissions.'}]}}
