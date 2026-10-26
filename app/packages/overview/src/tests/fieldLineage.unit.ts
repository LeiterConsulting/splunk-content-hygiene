// Synthetic contract tests only. These are never a runtime inventory source.
import { calculatedFieldInputs, declaredFieldScope, decodeFieldLineage, FieldCatalog,
    fieldLineageFacts, readFieldLineageFacts, readOutputProvenance,
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

test('malformed EXTRACT retains the declared default input but no guessed captures', () => {
    const result = decodeFieldLineage(props('EXTRACT-example', 'Inline', '(?<malformed'), 'field_extractions');
    expect(result.records[0]).toMatchObject({ operation: 'inline', inputs: ['_raw'], outputs: [], syntax: 'unsupported' });
    expect(result.issues[0].message).toMatch(/Unterminated/);
    expect(result.issues.some(issue => /without compiling or executing PCRE/.test(issue.message))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('(?<malformed');
});

test('inline outputs retain names, numbering, offsets and input provenance without raw expressions', () => {
    const value = '(one)(?<actor>customer-sensitive-pattern)(?P<status>.+) in payload';
    const result = decodeFieldLineage(props('EXTRACT-example', 'Inline', value), 'field_extractions');
    const facts = fieldLineageFacts(result.records[0], result.issues);
    expect(facts).toMatchObject({ inputs: ['payload'], outputs: ['actor', 'status'], syntax: 'partial', outputProvenance: {
        method: 'inline_named_captures', sourceField: 'payload', sourceOrigin: 'explicit_inline', regexCaptureCount: 3,
        declarations: [{ field: 'actor', capture: 2, offset: value.indexOf('(?<actor>'), attribute: 'value' },
            { field: 'status', capture: 3, offset: value.indexOf('(?P<status>'), attribute: 'value' }] } });
    expect(facts.limitations.some(message => /same-phase/.test(message))).toBe(true);
    expect(JSON.stringify(facts)).not.toContain('customer-sensitive-pattern');
    expect(readFieldLineageFacts(facts)).toEqual(facts);
    expect(readFieldLineageFacts({ ...facts, operation: 'alias' })).toBeUndefined();
    expect(readFieldLineageFacts({ ...facts, inputs: ['other'] })).toBeUndefined();
    expect(readFieldLineageFacts({ ...facts, outputs: [...facts.outputs, 'invented'] })).toBeUndefined();
    expect(readFieldLineageFacts({ ...facts, outputProvenance: { ...facts.outputProvenance, sourceField: null } })).toBeUndefined();
    const projected = readFieldLineageFacts({ ...facts, regex: value, outputProvenance: { ...facts.outputProvenance,
        regex: value, declarations: facts.outputProvenance!.declarations.map(item => ({ ...item, value: 'secret' })) } });
    expect(projected).toEqual(facts);
    expect(readOutputProvenance({ ...facts.outputProvenance, regexCaptureCount: 1 })).toBeUndefined();
    expect(readOutputProvenance({ ...facts.outputProvenance, sourceOrigin: 'source_key' })).toBeUndefined();
    expect(readOutputProvenance({ ...facts.outputProvenance, declarations: [{ field: 'actor', capture: null, offset: 0, attribute: 'value' }] })).toBeUndefined();
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

test('literal transform names survive malformed REGEX but do not claim capture attribution', () => {
    const result = decodeFieldLineage({ name: 'example_transform', acl, content: { REGEX: '(?<malformed', FORMAT: 'user::$1 custom::field::$2', SOURCE_KEY: '_raw', disabled: '0' } }, 'field_transforms');
    expect(result.issues.some(issue => /capture numbering or key cleaning is unverified/.test(issue.message))).toBe(true);
    expect(result.records[0]).toMatchObject({ inputs: ['_raw'], outputs: ['user', 'custom::field'], operation: 'transform', scope: null, enabled: true, syntax: 'partial' });
    expect(result.records[0].outputProvenance).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('(?<malformed');
});

test('dynamic transform field names and index-time routing do not become search-time outputs', () => {
    const base = { name: 'example_transform', acl, content: { FORMAT: '$1::$2', SOURCE_KEY: '_raw', disabled: '0' } };
    expect(decodeFieldLineage(base, 'field_transforms').records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
    expect(decodeFieldLineage({ ...base, content: { ...base.content, FORMAT: 'output::$1', DEST_KEY: 'queue' } }, 'field_transforms').records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});

test('literal FIELDS output lists and disabled transform metadata are preserved', () => {
    expect(decodeFieldLineage({ name: 'example_delimited', acl, content: { FIELDS: 'user, action', SOURCE_KEY: '_raw', disabled: '1' } }, 'field_transforms').records[0])
        .toMatchObject({ inputs: ['_raw'], outputs: ['user', 'action'], enabled: false, syntax: 'partial' });
});

const transform = (content: Record<string, unknown>) => decodeFieldLineage({ name: 'example_transform', acl, content: { disabled: 'False', ...content } }, 'field_transforms');
test('named transform REGEX outputs use default source and empty FORMAT without executing PCRE', () => {
    const pattern = '(prefix)(?<actor>customer-secret)(?P<status>.+)';
    const result = transform({ REGEX: pattern, FORMAT: '', WRITE_META: 'False', CLEAN_KEYS: 'True' });
    expect(result.records[0]).toMatchObject({ enabled: true, inputs: ['_raw'], outputs: ['actor', 'status'], syntax: 'partial', outputProvenance: {
        method: 'transform_named_captures', sourceField: '_raw', sourceOrigin: 'default_raw', regexCaptureCount: 3,
        declarations: [{ field: 'actor', capture: 2, offset: pattern.indexOf('(?<actor>'), attribute: 'REGEX' },
            { field: 'status', capture: 3, offset: pattern.indexOf('(?P<status>'), attribute: 'REGEX' }] } });
    const facts = fieldLineageFacts(result.records[0], result.issues);
    expect(readFieldLineageFacts(facts)).toEqual(facts);
    expect(JSON.stringify(facts)).not.toContain('customer-secret');
});
test('literal FORMAT attribution validates group references and preserves repeated positions', () => {
    const result = transform({ REGEX: '(one)(two)', FORMAT: 'actor::$2 actor::$1 status::$1', SOURCE_KEY: 'payload' });
    expect(result.records[0]).toMatchObject({ inputs: ['payload'], outputs: ['actor', 'status'], outputProvenance: {
        method: 'transform_format', sourceField: 'payload', sourceOrigin: 'source_key', regexCaptureCount: 2,
        declarations: [{ field: 'actor', capture: 2, offset: 0, attribute: 'FORMAT' },
            { field: 'actor', capture: 1, offset: 10, attribute: 'FORMAT' }, { field: 'status', capture: 1, offset: 20, attribute: 'FORMAT' }] } });
    expect(readFieldLineageFacts(fieldLineageFacts(result.records[0], result.issues))).toBeDefined();
});
test.each(['actor::$0', 'actor::$2', 'actor::$9999999999999999999999999'])('missing/out-of-range FORMAT captures do not become producer evidence: %s', FORMAT => {
    const result = transform({ REGEX: '(one)', FORMAT });
    expect(result.records[0]).toMatchObject({ outputs: ['actor'], syntax: 'partial' });
    expect(result.records[0].outputProvenance).toBeUndefined();
});
test.each(['$1::$2', 'actor::literal', 'actor::$1$2'])('dynamic/unsupported FORMAT does not invent names: %s', FORMAT => {
    expect(transform({ REGEX: '(one)(two)', FORMAT }).records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});
test.each(['DEST_KEY', 'CLONE_SOURCETYPE', 'INGEST_EVAL', 'STOP_PROCESSING_IF'])('index-time %s excludes search-time producer attribution', key => {
    expect(transform({ REGEX: '(?<actor>.+)', [key]: 'configured' }).records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});
test.each([true, 'True', 'TRUE', '1', 1])('native WRITE_META=%s is decoded without case-sensitive routing mistakes', WRITE_META => {
    expect(transform({ REGEX: '(?<actor>.+)', WRITE_META }).records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});
test('key cleaning is never silently translated into an effective output name', () => {
    expect(transform({ REGEX: '(one)', FORMAT: 'actor.name::$1' }).records[0]).toMatchObject({ outputs: ['actor.name'], syntax: 'partial' });
    expect(transform({ REGEX: '(one)', FORMAT: 'actor.name::$1' }).records[0].outputProvenance).toBeUndefined();
    expect(transform({ REGEX: '(one)', FORMAT: 'actor.name::$1', CLEAN_KEYS: 'false' }).records[0].outputProvenance).toBeDefined();
    expect(transform({ REGEX: '(?<_actor>.+)' }).records[0].outputs).toEqual([]);
    expect(transform({ REGEX: '(?<_actor>.+)', CLEAN_KEYS: false }).records[0]).toMatchObject({ outputs: ['_actor'], outputProvenance: { method: 'transform_named_captures' } });
});
test('indexed SOURCE_KEY semantics remain unknown even when output names are declared', () => {
    const result = transform({ REGEX: '(?<actor>.+)', SOURCE_KEY: 'fields:payload' });
    expect(result.records[0]).toMatchObject({ inputs: [], outputs: ['actor'], outputProvenance: { sourceField: null, sourceOrigin: 'unknown' } });
    expect(readFieldLineageFacts(fieldLineageFacts(result.records[0], result.issues))).toBeDefined();
});
test('DELIMS/FIELDS attribution requires an unambiguous mechanism and records literal name positions', () => {
    const result = transform({ FIELDS: ' actor, status', DELIMS: ',' });
    expect(result.records[0]).toMatchObject({ outputs: ['actor', 'status'], outputProvenance: { method: 'transform_fields', regexCaptureCount: null,
        declarations: [{ field: 'actor', capture: null, offset: 1, attribute: 'FIELDS' }, { field: 'status', capture: null, offset: 8, attribute: 'FIELDS' }] } });
    expect(readFieldLineageFacts(fieldLineageFacts(result.records[0], result.issues))).toBeDefined();
    expect(transform({ FIELDS: 'actor', DELIMS: ',', REGEX: '(one)' }).records[0].outputProvenance).toBeUndefined();
    expect(transform({ FIELDS: 'actor', DELIMS: ',', FORMAT: 'actor::$1' }).records[0].outputProvenance).toBeUndefined();
    expect(transform({ DELIMS: ',' }).records[0]).toMatchObject({ outputs: [], syntax: 'unsupported' });
});
test('named and explicit FORMAT mechanisms are not silently unioned', () => {
    const result = transform({ REGEX: '(?<raw_name>.+)', FORMAT: 'actor::$1' });
    expect(result.records[0]).toMatchObject({ outputs: ['actor'], outputProvenance: { method: 'transform_format' } });
    expect(result.issues.some(issue => /coexist/.test(issue.message))).toBe(true);
});

test('dense FORMAT positions are capped without losing the explicit coverage gap or cache readability', () => {
    const FORMAT = Array.from({ length: FIELD_DECLARATION_ITEMS + 1 }, () => 'actor::$1').join(' ');
    const result = transform({ REGEX: '(one)', FORMAT });
    const facts = fieldLineageFacts(result.records[0], result.issues);
    expect(facts).toMatchObject({ outputs: ['actor'], syntax: 'partial', outputProvenance: { method: 'transform_format', regexCaptureCount: 1 } });
    expect(facts.outputProvenance!.declarations).toHaveLength(FIELD_DECLARATION_ITEMS);
    expect(facts.outputProvenance!.declarations[FIELD_DECLARATION_ITEMS - 1].offset).toBe((FIELD_DECLARATION_ITEMS - 1) * 10);
    expect(result.issues.some(issue => issue.code === 'limit' && /additional positions remain unverified/.test(issue.message))).toBe(true);
    expect(readFieldLineageFacts(facts)).toEqual(facts);
});

test.each(['FORMAT', 'FIELDS'])('oversized %s names fail closed rather than publishing unreadable compact facts', attribute => {
    const field = 'a'.repeat(4097);
    const result = transform(attribute === 'FORMAT' ? { REGEX: '(one)', FORMAT: `${field}::$1` } : { DELIMS: ',', FIELDS: field });
    const facts = fieldLineageFacts(result.records[0], result.issues);
    expect(facts).toMatchObject({ outputs: [], syntax: 'unsupported' });
    expect(facts.outputProvenance).toBeUndefined();
    expect(readFieldLineageFacts(facts)).toEqual(facts);
});
