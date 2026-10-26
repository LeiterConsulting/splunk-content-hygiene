// Synthetic contract tests only. These are never a runtime inventory source.
import { calculatedFieldInputs, declaredFieldScope, decodeFieldLineage, FieldCatalog,
    FIELD_DECLARATION_BYTES, FIELD_DECLARATION_ITEMS, FIELD_EXPRESSION_DEPTH, FIELD_EXPRESSION_TOKENS } from '../services/fieldLineage';

const acl = { app: 'example', owner: 'reviewer', sharing: 'app' };
const props = (attribute: string, type: string, value: unknown, extra = {}) => ({
    name: `example:events : ${attribute}`, acl,
    content: { stanza: 'example:events', attribute, type, value, ...extra },
});
const aliases = () => props('FIELDALIAS-example', 'FIELDALIAS', '"actor.name" ASNEW user host ASNEW dest', { overwrite: false });
const calculated = (value: unknown, extra = {}) => props('EVAL-result', 'EVAL', value, { 'field.name': 'result', ...extra });

test.each(['user', 'system', 'unknown', undefined])('field declarations with %s visibility do not leak identities', sharing => {
    const row = { ...aliases(), name: 'private-sensitive-name', acl: { ...acl, sharing, app: 'private-sensitive-app' } };
    const result = decodeFieldLineage(row, 'field_aliases');
    expect(result.records).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('private-sensitive');
});

test('private exclusion occurs before reading a private native name', () => {
    const row = { acl: { ...acl, sharing: 'user' }, get name(): string { throw new Error('Private name must not be read'); } };
    expect(decodeFieldLineage(row, 'field_aliases').records).toEqual([]);
});

test('authoritative top-level ACL cannot be replaced by a nested global ACL', () => {
    const row = aliases();
    expect(decodeFieldLineage({ ...row, acl: null, content: { ...row.content, 'eai:acl': { ...acl, sharing: 'global' } } }, 'field_aliases').records).toEqual([]);
    expect(decodeFieldLineage({ ...row, acl: undefined, content: { ...row.content, 'eai:acl': { ...acl, sharing: 'global' } } }, 'field_aliases').records[0].sharing).toBe('global');
});

test('unsupported catalog IDs do not look up prototype entries', () => {
    expect(decodeFieldLineage(aliases(), 'constructor' as FieldCatalog)).toMatchObject({ records: [], issues: [{ code: 'invalid_definition' }] });
});

test.each([
    ['example:events', 'sourcetype', 'example:events', true], ['host::example-host', 'host', 'example-host', true],
    ['source::/example/path', 'source', '/example/path', true], ['source::/example/...', 'source', '/example/...', false],
    ['host::example*', 'host', 'example*', false], ['default', 'sourcetype', 'default', false],
    ['rule::example', 'sourcetype', 'rule::example', false], ['source::/encoded%20value', 'source', '/encoded%20value', false],
])('scope retains literal metadata without claiming pattern applicability: %s', (stanza, field, value, exact) => {
    expect(declaredFieldScope(String(stanza))).toEqual({ field, value, exact });
});

test('REPORT retains ordered, repeated explicit transform names, namespace and provenance', () => {
    const result = decodeFieldLineage(props('REPORT-example', 'Uses transform', 'first second, first'), 'field_extractions');
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ nativeName: 'example:events : REPORT-example', canonicalName: 'example:events : REPORT-example',
        app: 'example', owner: 'reviewer', sharing: 'app', operation: 'report', enabled: null,
        transforms: ['first', 'second', 'first'], inputs: [], outputs: [], syntax: 'declared',
        sourceLocation: 'props.conf["example:events"]["REPORT-example"]' });
});

test.each(['one,$runtime$', 'one, *', 'one,,two', ',one', 'one,', 'one "two three"'])('unsupported REPORT does not emit partially guessed targets: %s', value => {
    expect(decodeFieldLineage(props('REPORT-example', 'Uses transform', value), 'field_extractions').records[0]).toMatchObject({ transforms: [], syntax: 'unsupported' });
});

test('REPORT reference fan-out is capped with an explicit limit issue', () => {
    const value = Array.from({ length: FIELD_DECLARATION_ITEMS + 1 }, (_v, i) => `example_${i}`).join(',');
    const result = decodeFieldLineage(props('REPORT-example', 'Uses transform', value), 'field_extractions');
    expect(result.records[0].transforms).toHaveLength(FIELD_DECLARATION_ITEMS);
    expect(result.records[0].syntax).toBe('partial');
    expect(result.issues).toEqual([expect.objectContaining({ code: 'limit' })]);
});

test('EXTRACT remains an inventoried opaque regex without evaluating malformed PCRE', () => {
    const result = decodeFieldLineage(props('EXTRACT-example', 'Inline', '(?<malformed'), 'field_extractions');
    expect(result.records[0]).toMatchObject({ operation: 'inline', inputs: [], outputs: [], syntax: 'unsupported' });
    expect(result.issues[0].message).toMatch(/not interpreted or executed/);
    expect(JSON.stringify(result)).not.toContain('(?<malformed');
});

test('inconsistent native props names retain only their shared identity, not guessed scope', () => {
    const row = { ...aliases(), name: 'a different native identity' };
    expect(decodeFieldLineage(row, 'field_aliases').records[0]).toMatchObject({ canonicalName: row.name, scope: null, inputs: [], outputs: [], syntax: 'unsupported' });
});

test('aliases retain ASNEW versus AS and preserve the original field, without chaining aliases', () => {
    const result = decodeFieldLineage(aliases(), 'field_aliases');
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ inputs: ['actor.name', 'host'], outputs: ['user', 'dest'], enabled: null,
        aliases: [{ input: 'actor.name', output: 'user', mode: 'ASNEW' }, { input: 'host', output: 'dest', mode: 'ASNEW' }], syntax: 'declared' });
    expect(decodeFieldLineage(props('FIELDALIAS-example', 'FIELDALIAS', 'source AS target', { overwrite: true }), 'field_aliases').records[0].aliases[0].mode).toBe('AS');
});

test.each(['as', 'As', 'aS', 'asnew', 'AsNew'])('native alias keyword case is independent of field-name case: %s', operator => {
    const result = decodeFieldLineage(props('FIELDALIAS-example', 'FIELDALIAS', `Source ${operator} Destination`), 'field_aliases');
    expect(result.records[0]).toMatchObject({ inputs: ['Source'], outputs: ['Destination'], syntax: 'declared',
        aliases: [{ input: 'Source', output: 'Destination', mode: operator.toUpperCase() }] });
});

test.each(['source AS', 'source target', 'source AS target * AS output', 'source ASNEW $runtime$', 'source "AS" target'])('invalid aliases do not emit partial field lineage: %s', value => {
    expect(decodeFieldLineage(props('FIELDALIAS-example', 'FIELDALIAS', value), 'field_aliases').records[0]).toMatchObject({ inputs: [], outputs: [], aliases: [], syntax: 'unsupported' });
});

test('ambiguous duplicate alias outputs remain explicit rather than choosing a winner', () => {
    const result = decodeFieldLineage(props('FIELDALIAS-example', 'FIELDALIAS', 'first AS output second AS output'), 'field_aliases');
    expect(result.records[0]).toMatchObject({ inputs: ['first', 'second'], outputs: ['output'], syntax: 'partial' });
    expect(result.issues[0].message).toMatch(/winning assignment remains unverified/);
});

test('native overwrite disagreement does not override the literal ASNEW operator', () => {
    const result = decodeFieldLineage(props('FIELDALIAS-example', 'FIELDALIAS', 'source ASNEW target', { overwrite: true }), 'field_aliases');
    expect(result.records[0]).toMatchObject({ aliases: [{ input: 'source', output: 'target', mode: 'ASNEW' }], syntax: 'partial' });
});

test.each([
    ['"constant only"', []], ['status / 1000 + offset', ['status', 'offset']],
    ['coalesce(\'actor.name\', user)', ['actor.name', 'user']],
    ['if(status=200 AND isnotnull(user),lower(user),"unknown")', ['status', 'user']],
    ['case(status>=500,"error",status<400,"ok",true(),"other")', ['status']],
    ['json_extract(_raw,"path.with.dots")', ['_raw']],
    ['round((bytes_in + bytes_out) / 1e3,2)', ['bytes_in', 'bytes_out']],
    ['\'field with spaces\'."/".host', ['field with spaces', 'host']],
    ['-duration + abs(offset)', ['duration', 'offset']],
    ['null()', []], ['NOT (flag=0)', ['flag']],
])('supported calculated syntax extracts only declared inputs: %s', (expression, inputs) => {
    expect(calculatedFieldInputs(String(expression))).toEqual({ inputs, complete: true });
});

test.each(['unknown_function(source)', 'constructor()', 'toString()', 'source +', 'if(source)', 'case(source,1,other)',
    'source | search secret', 'source $runtime$', 'source[dynamic]', '"unterminated', 'coalesce(source,)', 'source other'])('unsupported calculated syntax has no complete input claim: %s', expression => {
    expect(calculatedFieldInputs(expression)).toEqual({ inputs: [], complete: false });
});

test('calculated-field syntax is bounded by UTF-8 bytes, token count and nesting depth', () => {
    expect(calculatedFieldInputs(`"${'é'.repeat(FIELD_DECLARATION_BYTES / 2)}"`).complete).toBe(false);
    expect(calculatedFieldInputs(Array.from({ length: FIELD_EXPRESSION_TOKENS }, () => 'field').join('+')).complete).toBe(false);
    expect(calculatedFieldInputs(`${'('.repeat(FIELD_EXPRESSION_DEPTH + 1)}field${')'.repeat(FIELD_EXPRESSION_DEPTH + 1)}`).complete).toBe(false);
});

test('calculated field output must agree with native identity, and raw expressions do not enter decoded metadata', () => {
    const result = decodeFieldLineage(calculated('coalesce(original,"opaque secret literal")'), 'calculated_fields');
    expect(result.records[0]).toMatchObject({ inputs: ['original'], outputs: ['result'], operation: 'eval', syntax: 'declared' });
    expect(JSON.stringify(result)).not.toContain('opaque secret literal');
    expect(decodeFieldLineage(calculated('source', { 'field.name': 'different' }), 'calculated_fields').records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});

test('unsupported calculated syntax preserves its declared output but not an incomplete list of inputs', () => {
    expect(decodeFieldLineage(calculated('unknown_function(first,second)'), 'calculated_fields').records[0]).toMatchObject({ outputs: ['result'], inputs: [], syntax: 'unsupported' });
});

test('literal transform FORMAT outputs do not require executing the configured regex', () => {
    const result = decodeFieldLineage({ name: 'example_transform', acl, content: { REGEX: '(?<malformed', FORMAT: 'user::$1 custom::field::$2', SOURCE_KEY: '_raw', disabled: '0' } }, 'field_transforms');
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ inputs: ['_raw'], outputs: ['user', 'custom::field'], operation: 'transform', scope: null, enabled: true, syntax: 'declared' });
    expect(JSON.stringify(result)).not.toContain('(?<malformed');
});

test('dynamic transform field names and index-time routing do not become search-time outputs', () => {
    const base = { name: 'example_transform', acl, content: { FORMAT: '$1::$2', SOURCE_KEY: '_raw', disabled: '0' } };
    expect(decodeFieldLineage(base, 'field_transforms').records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
    expect(decodeFieldLineage({ ...base, content: { ...base.content, FORMAT: 'output::$1', DEST_KEY: 'queue' } }, 'field_transforms').records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});

test('literal FIELDS output lists and disabled transform metadata are preserved', () => {
    expect(decodeFieldLineage({ name: 'example_delimited', acl, content: { FIELDS: 'user, action', SOURCE_KEY: '_raw', disabled: '1' } }, 'field_transforms').records[0])
        .toMatchObject({ inputs: ['_raw'], outputs: ['user', 'action'], enabled: false });
});
