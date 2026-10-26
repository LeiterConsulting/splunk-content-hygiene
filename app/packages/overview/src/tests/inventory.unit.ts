import {
    canonicalObjectId,
    normalizeObjectEntry,
    normalizeKnowledgeEntries,
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

const tagCollector = { id: 'tag_bindings', label: 'Tag binding stanzas', endpoint: 'configs/conf-tags', objectType: 'Tag Binding' };
const eventCollector = { id: 'event_types', label: 'Event types', endpoint: 'saved/eventtypes', objectType: 'Event Type' };
const nativeAcl = { app: 'example', owner: 'nobody', sharing: 'app', perms: { read: ['user'], write: ['admin'] } };
const nativeTags = { name: 'eventtype=Example', acl: nativeAcl, content: { disabled: '0', exampleTag: 'enabled', retiredTag: 'disabled' } };

test('tag normalization retains each assignment identity, nested ACL, enabled state and source location', () => {
    const result = normalizeKnowledgeEntries([{ ...nativeTags, acl: undefined,
        content: { ...nativeTags.content, 'eai:acl': nativeAcl } }], tagCollector, 'scan-one', '2026-10-26T12:00:00Z');
    expect(result).toMatchObject({ complete: true, inventoryComplete: true, warnings: [] });
    expect(result.records.map(record => [record.name, record.enabled])).toEqual([
        ['["eventtype=Example","exampleTag"]', true], ['["eventtype=Example","retiredTag"]', false],
    ]);
    expect(result.records.every(record => record.app === 'example' && record.owner === null)).toBe(true);
    expect(result.sources[0].sourceLocation).toBe('tags.conf["eventtype=Example"]["exampleTag"]');
    expect(result.records[0].source.source_name).toBe('eventtype=Example');
});

test('editing another tag assignment does not overwrite or falsely change this binding fingerprint', () => {
    const first = normalizeKnowledgeEntries([nativeTags], tagCollector, 'scan-one', '2026-10-26T12:00:00Z');
    const changed = normalizeKnowledgeEntries([{ ...nativeTags, content: { ...nativeTags.content, retiredTag: 'enabled' } }], tagCollector, 'scan-two', '2026-10-26T12:01:00Z');
    expect(changed.records[0].object_id).toBe(first.records[0].object_id);
    expect(changed.records[0].configuration_fingerprint).toEqual(first.records[0].configuration_fingerprint);
    expect(changed.records[1].configuration_fingerprint).not.toEqual(first.records[1].configuration_fingerprint);
});

test('private, missing-ACL and duplicate native identities cannot enter or overwrite shared records', () => {
    const privateEntry = { ...nativeTags, name: 'eventtype=private-sensitive-identity', acl: { ...nativeAcl, sharing: 'user' } };
    const privateResult = normalizeKnowledgeEntries([privateEntry], tagCollector, 'scan-one', '2026-10-26T12:00:00Z');
    expect(privateResult.records).toEqual([]);
    expect(JSON.stringify(privateResult)).not.toContain('private-sensitive');
    expect(normalizeKnowledgeEntries([{ ...nativeTags, acl: undefined }], tagCollector, 'scan-one', '2026-10-26T12:00:00Z')).toMatchObject({ records: [], complete: false, inventoryComplete: false });
    const duplicate = normalizeKnowledgeEntries([nativeTags, nativeTags], tagCollector, 'scan-one', '2026-10-26T12:00:00Z');
    expect(duplicate.records).toEqual([]);
    expect(duplicate.sources).toEqual([]);
    expect(duplicate.inventoryComplete).toBe(false);
});

test('system inheritance and encoded values are analysis gaps, distinct from truncated shared inventory', () => {
    const event = { name: 'Example', acl: nativeAcl, content: { disabled: '0', search: 'sourcetype=example_events' } };
    const events = normalizeKnowledgeEntries([event, { ...event, name: 'builtin', acl: { ...nativeAcl, sharing: 'system' } }], eventCollector, 'scan-one', '2026-10-26T12:00:00Z');
    expect(events).toMatchObject({ complete: false, inventoryComplete: true });
    expect(events.records).toHaveLength(1);
    const encoded = normalizeKnowledgeEntries([{ ...nativeTags, name: 'eventtype=Example%20Encoded' }], tagCollector, 'scan-one', '2026-10-26T12:00:00Z');
    expect(encoded).toMatchObject({ complete: false, inventoryComplete: true });
    expect(encoded.records).toHaveLength(2);
    const limited = normalizeKnowledgeEntries([nativeTags], tagCollector, 'scan-one', '2026-10-26T12:00:00Z', 1);
    expect(limited).toMatchObject({ complete: false, inventoryComplete: false });
    expect(limited.records).toHaveLength(1);
    expect(limited.warnings.join(' ')).toMatch(/budget/);
});

test('event-type source text is transient analysis input, never a raw cached customer search', () => {
    const result = normalizeKnowledgeEntries([{ name: 'Example', acl: nativeAcl,
        content: { disabled: '0', search: 'sourcetype=example_events sensitive_payload_marker=example' } }], eventCollector, 'scan-one', '2026-10-26T12:00:00Z');
    expect(result.sources[0]).toMatchObject({ kind: 'event_type', text: expect.stringContaining('sensitive_payload_marker') });
    expect(JSON.stringify(result.records)).not.toContain('sensitive_payload_marker');
    expect(result.records[0].object_id).toBe('event_type::example::Example');
});
