// Synthetic decoder contracts only. No fixture is a runtime data source.
import { decodeEventType, decodeTagBindings, MAX_TAG_BINDINGS_PER_STANZA } from '../services/knowledgeCatalog';

const acl = { app: 'example', owner: 'reviewer', sharing: 'app' };
const eventType = { name: 'Purchase Complete', acl, content: {
    search: 'index=example sourcetype=transactions action=purchase', disabled: '0', priority: '5',
} };
const tags = { name: 'eventtype=Purchase Complete', acl, content: {
    commerce: 'enabled', success: 'enabled', retired: 'disabled', disabled: '0',
    'eai:appName': 'example', 'eai:acl': {},
} };

test('event types preserve exact identity, query metadata and source without dispatching it', () => {
    expect(decodeEventType(eventType, 'native.eventtypes[0]')).toEqual({ records: [{
        nativeName: 'Purchase Complete', canonicalName: 'Purchase Complete', app: 'example',
        owner: 'reviewer', sharing: 'app', search: eventType.content.search, enabled: true,
        priority: 5, sourceLocation: 'native.eventtypes[0]',
    }], issues: [] });
});

test.each(['user', 'system', 'unknown', undefined])('unqualified %s visibility does not enter the shared catalog', (sharing) => {
    const entry = { ...eventType, name: 'private-sensitive-name', acl: { ...acl, app: 'private-sensitive-app', sharing } };
    const result = decodeEventType(entry, 'private-sensitive-location');
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private-sensitive');
    expect(decodeTagBindings({ ...tags, ...entry }).records).toEqual([]);
});

test('missing ACL does not become global from an eai:appName or a search/tags summary', () => {
    expect(decodeEventType({ name: 'Example', content: { ...eventType.content, 'eai:appName': 'example' } }).records).toEqual([]);
    expect(decodeTagBindings({ name: 'commerce' }).records).toEqual([]);
    expect(decodeEventType({ ...eventType, acl: {}, content: { ...eventType.content, 'eai:acl': acl } }).records).toEqual([]);
});

test('nested authoritative ACL is accepted only when a top-level ACL is absent', () => {
    expect(decodeEventType({ ...eventType, acl: undefined, content: { ...eventType.content, 'eai:acl': { ...acl, sharing: 'global' } } }).records[0].sharing).toBe('global');
});

test.each([
    { label: 'null', search: null }, { label: 'empty', search: '' },
    { label: 'whitespace', search: '   ' }, { label: 'number', search: 42 },
    { label: 'over budget', search: 'a'.repeat(1024 * 1024 + 1) },
])('invalid definition remains an explicit gap: $label', ({ search }) => {
    const result = decodeEventType({ ...eventType, content: { ...eventType.content, search } });
    expect(result.records).toEqual([]);
    expect(result.issues[0].code).toBe('invalid_definition');
});

test.each([true, 1, '1', 'true'])('disabled event types retain their configuration with false enabled state: %s', (disabled) => {
    expect(decodeEventType({ ...eventType, content: { ...eventType.content, disabled } }).records[0].enabled).toBe(false);
});

test('missing enabled state is unknown, and unexpected priority does not invent a rank', () => {
    const result = decodeEventType({ ...eventType, content: { search: '*', priority: 'unexpected' } });
    expect(result.records[0]).toMatchObject({ enabled: null, priority: null });
    expect(result.issues[0].code).toBe('unknown_state');
});

test('tag assignments retain each native stanza/tag identity, including disabled bindings', () => {
    const result = decodeTagBindings(tags, 'native.tags[0]');
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(3);
    expect(result.records.map(row => [row.tag, row.enabled])).toEqual([
        ['commerce', true], ['retired', false], ['success', true],
    ]);
    expect(result.records[0]).toMatchObject({ field: 'eventtype', rawFieldValue: 'Purchase Complete',
        literalFieldValue: 'Purchase Complete', canonicalName: JSON.stringify([tags.name, 'commerce']),
        sourceLocation: 'native.tags[0]["eventtype=Purchase Complete"]["commerce"]' });
});

test('identical tag names on different field/value pairs and apps remain distinct identities', () => {
    const first = decodeTagBindings(tags).records[0];
    const second = decodeTagBindings({ ...tags, name: 'host=example-host' }).records[0];
    const third = decodeTagBindings({ ...tags, acl: { ...acl, app: 'other' } }).records[0];
    expect(first.canonicalName).not.toBe(second.canonicalName);
    expect([first.app, first.canonicalName]).not.toEqual([third.app, third.canonicalName]);
});

test('values containing equals signs are not split into extra fields or silently lowercased', () => {
    const result = decodeTagBindings({ ...tags, name: 'custom_field=Mixed=Value' }).records[0];
    expect(result.field).toBe('custom_field');
    expect(result.literalFieldValue).toBe('Mixed=Value');
});

test('encoded-looking values are retained without guessing a decoded event-type identity', () => {
    const result = decodeTagBindings({ ...tags, name: 'eventtype=Purchase%20Complete' });
    expect(result.records[0]).toMatchObject({ rawFieldValue: 'Purchase%20Complete', literalFieldValue: null });
    expect(result.issues[0].code).toBe('encoded_value');
});

test('parent disabled state suppresses all active bindings; missing state stays unknown', () => {
    expect(decodeTagBindings({ ...tags, content: { ...tags.content, disabled: '1' } }).records.every(row => row.enabled === false)).toBe(true);
    const unknown = decodeTagBindings({ ...tags, content: { commerce: 'enabled', retired: 'disabled' } });
    expect(unknown.records.map(row => row.enabled)).toEqual([null, false]);
    expect(unknown.issues[0].code).toBe('unknown_state');
});

test.each(['eventtype', '=value', 'eventtype=', 'unsupported field=value'])('unsupported tag stanza is a gap: %s', (name) => {
    const result = decodeTagBindings({ ...tags, name });
    expect(result.records).toEqual([]);
    expect(result.issues[0].code).toBe('invalid_binding');
});

test('unsupported states and reserved-key ambiguity cannot silently become enabled tags', () => {
    const result = decodeTagBindings({ ...tags, content: { disabled: 'enabled', commerce: true, retired: 'DISABLED' } });
    expect(result.records).toEqual([]);
    expect(result.issues.some(issue => issue.code === 'invalid_binding')).toBe(true);
});

test('metadata-like tag names remain an explicit ambiguity instead of an active binding', () => {
    const result = decodeTagBindings({ ...tags, content: { disabled: '0', 'eai:example': 'enabled' } });
    expect(result.records).toEqual([]);
    expect(result.issues.map(issue => issue.code)).toEqual(['invalid_binding']);
});

test('unsupported state values are never coerced or executed', () => {
    const toString = jest.fn(() => { throw new Error('Untrusted metadata must not execute.'); });
    const value = { toString };
    const event = decodeEventType({ ...eventType, content: { ...eventType.content, disabled: value, priority: value } });
    const bindings = decodeTagBindings({ ...tags, content: { disabled: value, commerce: value } });
    expect(event.records[0]).toMatchObject({ enabled: null, priority: null });
    expect(bindings.records).toEqual([]);
    expect(toString).not.toHaveBeenCalled();
});

test('prototype-like tag attributes remain ordinary data without mutating other objects', () => {
    const content = Object.fromEntries([['disabled', '0'], ['__proto__', 'enabled'], ['constructor', 'enabled']]);
    const result = decodeTagBindings({ ...tags, content });
    expect(result.issues).toEqual([]);
    expect(result.records.map(row => row.tag)).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(content)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('enabled');
});

test('whitespace or control-character identities are not trimmed into a different shared object', () => {
    [' Purchase Complete', 'Purchase Complete ', 'Purchase\nComplete'].forEach((name) => {
        const result = decodeEventType({ ...eventType, name });
        expect(result.records).toEqual([]);
        expect(result.issues[0].code).toBe('identity_unavailable');
    });
});

test('tag fan-out is bounded and truncation is disclosed', () => {
    const content = Object.fromEntries(Array.from({ length: MAX_TAG_BINDINGS_PER_STANZA + 1 }, (_value, i) => [`tag${i}`, 'enabled']));
    const result = decodeTagBindings({ ...tags, content: { ...content, disabled: '0' } });
    expect(result.records).toHaveLength(MAX_TAG_BINDINGS_PER_STANZA);
    expect(result.issues.filter(issue => issue.code === 'limit')).toHaveLength(1);
});
