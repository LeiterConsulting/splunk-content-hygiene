import {
    canonicalObjectId,
    normalizeObjectEntry,
    stableRecordKey,
} from '../services/inventory';
import { ConfigurationFingerprint } from '../types';

test('builds stable identities that distinguish private user namespaces', () => {
    const sharedObjectId = canonicalObjectId(
        'Saved Search',
        'search',
        'Daily Error Review'
    );
    const analystObjectId = canonicalObjectId(
        'Saved Search',
        'search',
        'Daily Error Review',
        'analyst'
    );
    const reviewerObjectId = canonicalObjectId(
        'Saved Search',
        'search',
        'Daily Error Review',
        'reviewer'
    );

    expect(sharedObjectId).toBe('saved_search::search::Daily Error Review');
    expect(analystObjectId).toBe(
        'saved_search::search::user:analyst::Daily Error Review'
    );
    expect(reviewerObjectId).not.toBe(analystObjectId);
    expect(stableRecordKey(sharedObjectId)).toBe(
        stableRecordKey(sharedObjectId)
    );
    expect(stableRecordKey(sharedObjectId)).not.toBe(
        stableRecordKey(`${sharedObjectId} changed`)
    );
});

test('normalizes REST metadata conservatively without inventing usage', () => {
    const normalized = normalizeObjectEntry(
        {
            name: 'Daily Error Review',
            updated: '2026-07-24T16:00:00Z',
            acl: {
                app: 'search',
                owner: 'analyst',
                sharing: 'app',
            },
            content: {
                disabled: false,
                label: 'Daily Error Review',
            },
        },
        {
            id: 'saved_searches',
            label: 'Saved searches, reports, and alerts',
            endpoint: 'saved/searches',
            namespace: { owner: '-', app: '-' },
            objectType: 'Saved Search',
        },
        'scan-test',
        '2026-07-24T17:00:00Z'
    );

    expect(normalized.object_id).toBe(
        'saved_search::search::Daily Error Review'
    );
    expect(normalized.owner).toBe('analyst');
    expect(normalized.health_status).toBe('unknown');
    expect(normalized.last_used).toBeNull();
    expect(normalized.abandonment_confidence).toBeNull();
    expect(normalized.evidence).toContain(
        'No usage conclusion was inferred from configuration metadata'
    );
});

test('protects system content from cleanup review by default', () => {
    const normalized = normalizeObjectEntry(
        {
            name: 'Internal Health',
            acl: {
                app: 'splunk_monitoring_console',
                owner: 'nobody',
                sharing: 'app',
            },
            content: { disabled: false },
        },
        {
            id: 'dashboards',
            label: 'Dashboards',
            endpoint: 'data/ui/views',
            objectType: 'Dashboard',
        },
        'scan-test',
        '2026-07-24T17:00:00Z'
    );

    expect(normalized.protected).toBe(true);
    expect(normalized.health_status).toBe('protected');
    expect(normalized.owner).toBeNull();
});

test('includes owner namespace in private user-scoped object identity', () => {
    const normalized = normalizeObjectEntry(
        {
            name: 'Daily Error Review',
            acl: {
                app: 'search',
                owner: 'analyst',
                sharing: 'user',
            },
            content: { disabled: false },
        },
        {
            id: 'saved_searches',
            label: 'Saved searches, reports, and alerts',
            endpoint: 'saved/searches',
            objectType: 'Saved Search',
        },
        'scan-test',
        '2026-07-24T17:00:00Z'
    );

    expect(normalized.object_id).toBe(
        'saved_search::search::user:analyst::Daily Error Review'
    );
});

test('automatic lookup mapping changes retain identity while changing configuration evidence', () => {
    const collector = { id: 'automatic_lookups', label: 'Automatic lookup rules (props)', endpoint: 'data/props/lookups', objectType: 'Automatic Lookup' };
    const entry = { name: 'events : LOOKUP-enrich', acl: { app: 'example', owner: 'nobody', sharing: 'app' },
        content: { stanza: 'events', attribute: 'LOOKUP-enrich', transform: 'owners', type: 'LOOKUP', value: 'owners key OUTPUT owner', 'lookup.field.output.0': 'owner' } };
    const first = normalizeObjectEntry(entry, collector, 'scan-one', '2026-10-25T11:00:00Z');
    const second = normalizeObjectEntry({ ...entry, content: { ...entry.content, 'lookup.field.output.0': 'team' } }, collector, 'scan-two', '2026-10-25T12:00:00Z');
    expect(first.object_id).toBe('automatic_lookup::example::events : LOOKUP-enrich');
    expect(second.object_id).toBe(first.object_id);
    const firstFingerprint = first.configuration_fingerprint as ConfigurationFingerprint;
    const secondFingerprint = second.configuration_fingerprint as ConfigurationFingerprint;
    expect(secondFingerprint.digest).not.toBe(firstFingerprint.digest);
    expect(secondFingerprint.accessDigest).toBe(firstFingerprint.accessDigest);
});
