// Synthetic parser/storage/export contracts; not native execution evidence.
import { parseDashboard, parseSpl, SPL_SOURCE_LIMIT } from '../services/dependencyParser';
import { analyzeInventory, RawAnalysisSource } from '../services/analysis';
import { attachReviewEvidence } from '../services/reviewEvidence';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { CALLER_CONTEXT_BYTES, CALLER_CONTEXT_ROWS, CALLER_CONTEXT_SCAN_BYTES, callerContextCsv, callerContextReport, callerContextSize, emptyCallerContext, mergeCallerContext, readCallerContext } from '../services/callerContextDiagnostics';
import { object, snapshot } from './milestoneFixtures';
import { fieldCompleteness } from './fieldFixtures';

test.each([
    ['`scope` sourcetype=x host=$node$ OR source=*', 'macro_invocation'],
    ['sourcetype=$kind$ host=x', 'dynamic_term'], ['sourcetype=x* host=x', 'pattern_or_nonliteral_selector'],
    ['sourcetype=x host=y OR host=z', 'positive_or'], ['sourcetype=x NOT host=y', 'negation'],
    ['sourcetype IN (x,y)', 'in_operator'], ['(sourcetype=x host=y)', 'grouping_or_list_punctuation'],
    ['sourcetype=x [ search host=y ]', 'subsearch'], ['"sourcetype=x"', 'standalone_quoted_term'],
    ['sourcetype=x sourcetype=y', 'contradictory_selector'], ['sourcetype=x AND', 'malformed_conjunction'],
    ['index=x', 'no_context_selector'], ['| inputlookup table', 'no_initial_clause'],
    ['sourcetype="unterminated', 'malformed_lexical'], ['sourcetype="x\\y"', 'escaped_initial_clause'],
    ['sourcetype=', 'invalid_assignment_value'], ['error sourcetype=x', 'bare_or_unsupported_initial_term'],
] as const)('strict rejection explanation for %s remains %s', (text, reason) => {
    const parsed = parseSpl(text, 'search');
    expect(parsed.propsEventScopes).toEqual([]);
    expect(parsed.callerContext?.rows[0]).toMatchObject({ outcome: 'withheld', firstRejection: reason });
    expect(readCallerContext(parsed.callerContext)).toEqual(parsed.callerContext);
});

test('co-occurring features do not replace the first rejection or leak source values', () => {
    const text = '`sensitive_macro` sourcetype=private:kind host=$private_token$ OR source=secret*';
    const data = parseSpl(text).callerContext!;
    expect(data.rows[0].features).toEqual(expect.arrayContaining(['macro_invocation', 'dynamic_term', 'positive_or', 'pattern_or_nonliteral_selector']));
    expect(data.rows[0].firstRejection).toBe('macro_invocation');
    expect(JSON.stringify(data)).not.toMatch(/sensitive_macro|private:kind|private_token|secret\*/);
    expect(data.rows[0].queryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(data.counts).toEqual({ queries: 1, retained: 0, withheld: 1, postProcess: 0 });
});

test('strings, comments and pipes do not create false initial syntax features', () => {
    const parsed = parseSpl('sourcetype="literal" host="OR" ``` OR IN `macro` $token$ ``` | eval note="NOT sourcetype=*"');
    expect(parsed.propsEventScopes?.[0].selectors.map(row => [row.field, row.value])).toEqual([['sourcetype', 'literal'], ['host', 'OR']]);
    expect(parsed.callerContext?.rows[0]).toMatchObject({ outcome: 'retained', firstRejection: null, offset: null, features: [] });
});

test('separated assignments preserve exact source offsets without retaining selector values', () => {
    const parsed = parseSpl('search sourcetype = "literal" AND host=node');
    expect(parsed.propsEventScopes?.[0].selectors).toEqual([
        { field: 'sourcetype', value: 'literal', sourceLocation: 'search:20' },
        { field: 'host', value: 'node', sourceLocation: 'search:34' },
    ]);
    expect(parsed.callerContext?.counts.retained).toBe(1);
});

test('classic post-process and Studio chain queries are counted but never promoted', () => {
    const xml = parseDashboard('<dashboard><search id="base"><query>sourcetype=x host=y</query></search><search base="base"><query>sourcetype=z host=w</query></search></dashboard>');
    expect(xml.callerContext?.counts).toEqual({ queries: 2, retained: 1, withheld: 0, postProcess: 1 });
    expect(xml.callerContext?.rows[1]).toMatchObject({ outcome: 'post_process', firstRejection: null, features: [], selectorMentioned: false });
    expect(xml.propsEventScopes).toHaveLength(1);
    const studio = parseDashboard(JSON.stringify({ dataSources: { base: { type: 'ds.search', options: { query: 'sourcetype=x host=y' } },
        child: { type: 'ds.chain', options: { query: 'sourcetype=z host=w' } } } }));
    expect(studio.callerContext?.counts).toEqual(xml.callerContext?.counts);
    const wrapper = parseDashboard(`<dashboard version="2"><definition><![CDATA[${JSON.stringify({ dataSources: { base: { type: 'ds.search', options: { query: 'sourcetype=x' } } } })}]]></definition></dashboard>`);
    expect(wrapper.callerContext?.counts).toEqual({ queries: 1, retained: 1, withheld: 0, postProcess: 0 });
    expect(wrapper.callerContext?.rows[0].sourceLocation).toBe('dashboard.definition.dataSources.base.options.query');
});

test('malformed, unavailable, large and location-limited sources stay explicitly unknown', () => {
    expect(parseDashboard('<dashboard>').callerContext).toMatchObject({ state: 'unavailable', sourceIncomplete: true });
    expect(parseSpl('x'.repeat(SPL_SOURCE_LIMIT + 1)).callerContext).toMatchObject({ state: 'budget', limited: true, sourceIncomplete: true, rows: [] });
    expect(parseSpl('sourcetype=x', 'x'.repeat(4097)).callerContext).toMatchObject({ limited: true, rows: [], counts: { withheld: 1 } });
    expect(parseSpl(`sourcetype=x ${Array.from({ length: 513 }, () => 'a=b').join(' ')}`).callerContext?.rows[0].firstRejection).toBe('initial_token_limit');
});

test('row and UTF-8 byte caps keep complete extracted occurrence counts without claiming full detail', () => {
    const data = emptyCallerContext();
    for (let i = 0; i < 80; i += 1) { mergeCallerContext(data, parseSpl('sourcetype=x', `query[${i}]`).callerContext!); }
    expect(data.counts.queries).toBe(80); expect(data.rows).toHaveLength(CALLER_CONTEXT_ROWS); expect(data.limited).toBe(true);
    const unicode = emptyCallerContext();
    for (let i = 0; i < 20; i += 1) { mergeCallerContext(unicode, parseSpl('sourcetype=x', `${'界'.repeat(4000)}:${i}`).callerContext!); }
    expect(unicode.counts.queries).toBe(20); expect(unicode.rows.length).toBeLessThan(20);
    expect(callerContextSize(unicode)).toBeLessThanOrEqual(CALLER_CONTEXT_BYTES); expect(readCallerContext(unicode)).toEqual(unicode);
});

test('cache reader rejects incompatible, malformed and inconsistent evidence and whitelists unknown fields', () => {
    const data = parseSpl('sourcetype=x').callerContext!;
    [{ version: 2 }, { policy: 'future' }, { counts: { queries: 0, retained: 1, withheld: 0, postProcess: 0 } },
        { limited: false, rows: [] }, { rows: [{ ...data.rows[0], outcome: 'withheld' }] }, { rows: [{ ...data.rows[0], queryDigest: 'bad' }] },
        { rows: [{ ...data.rows[0], offset: -1 }] }, { rows: [{ ...data.rows[0], features: ['unknown'] }] }].forEach(changes => {
        expect(readCallerContext({ ...data, ...changes })).toBeUndefined();
    });
    expect(readCallerContext({ ...data, rawSpl: 'must-not-escape', rows: [{ ...data.rows[0], rawValue: 'must-not-escape' }] })).toEqual(data);
});

test('scan diagnostic-detail cap preserves explicit counts/unknown markers without changing the caller set', () => {
    const text = JSON.stringify({ dataSources: Array.from({ length: 60 }, () => ({ type: 'ds.search', options: { query: 'sourcetype=x host=node' } })) });
    const parsed = parseDashboard(text, '界'.repeat(1000));
    const objects = Array.from({ length: 200 }, (_value, i) => object(`dashboard-${i}`, 'Dashboard'));
    const sources: RawAnalysisSource[] = objects.map(row => ({ objectId: row.objectId, kind: 'dashboard', text, sourceLocation: '界'.repeat(1000) }));
    const result = analyzeInventory(objects, sources, fieldCompleteness, new Map(sources.map(source => [source, parsed])));
    const recorded = result.objects.filter(row => row.callerContext?.state === 'recorded');
    const omitted = result.objects.filter(row => row.callerContext?.state === 'budget');
    expect(result.objects).toHaveLength(objects.length); expect(omitted.length).toBeGreaterThan(0);
    expect(recorded.reduce((total, row) => total + callerContextSize(row.callerContext), 0)).toBeLessThanOrEqual(CALLER_CONTEXT_SCAN_BYTES);
    expect(omitted.every(row => row.callerContext?.limited && row.callerContext.rows.length === 0 && row.callerContext.counts.queries === 60)).toBe(true);
    expect(omitted.every(row => readCallerContext(row.callerContext) !== undefined)).toBe(true);
});

test('diagnostics are additive and do not change analysis, removal readiness or review evidence', async () => {
    const caller = object('caller', 'Report'); const macro = object('macro');
    const source: RawAnalysisSource = { objectId: caller.objectId, kind: 'spl', text: '`macro` sourcetype=x host=$node$', sourceLocation: 'search' };
    const parsed = parseSpl(source.text, source.sourceLocation); const { callerContext: _diagnostics, ...without } = parsed;
    const before = analyzeInventory([caller, macro], [source], fieldCompleteness, new Map([[source, without]]));
    const after = analyzeInventory([caller, macro], [source], fieldCompleteness);
    const strip = (value: typeof after): unknown => ({ ...value, objects: value.objects.map(({ callerContext: _value, ...rest }) => rest) });
    expect(strip(after)).toEqual(strip(before));
    const data = snapshot(after.objects, after.edges);
    expect(analyzeRemovalImpact(after.objects[0], after.objects, after.edges, [], data.scan)).toEqual(analyzeRemovalImpact(before.objects[0], before.objects, before.edges, [], data.scan));
    const scope = { scanId: 'scan-fixture', observedAt: '2026-10-25T12:00:00Z', principal: 'operator', roles: ['hygiene_operator'], mode: 'full' as const,
        collectionComplete: true, analysisComplete: false, collectors: {} };
    const oldEvidence = await attachReviewEvidence(before.objects, before.edges, scope);
    const newEvidence = await attachReviewEvidence(after.objects, after.edges, scope);
    expect(newEvidence.map(row => row.reviewEvidence)).toEqual(oldEvidence.map(row => row.reviewEvidence));
    expect(after.objects[0].callerContext).toEqual(parsed.callerContext);
    expect(after.objects[1].callerContext).toBeUndefined();
});

test('CSV and JSON retain the same exact diagnostic facts including absent and zero-row evidence', () => {
    const caller = object('caller', 'Report');
    caller.callerContext = parseSpl('`macro` host=$node$').callerContext;
    const report = callerContextReport(caller); const csv = callerContextCsv(caller);
    const row = Object.fromEntries(csv.columns.map((column, index) => [column, csv.rows[0][index]]));
    expect(row['Query digest']).toBe(report.diagnostics?.rows[0].queryDigest);
    expect(row['Query location']).toBe(report.diagnostics?.rows[0].sourceLocation);
    expect(row['First rejection']).toBe(report.diagnostics?.rows[0].firstRejection);
    expect(JSON.parse(String(row['Observed syntax features']))).toEqual(report.diagnostics?.rows[0].features);
    expect(row.Withheld).toBe(report.diagnostics?.counts.withheld);
    expect(row['Next verification']).toBe(report.guidance[0].nextCheck);
    expect(row.Explanation).toBe(report.guidance[0].explanation);
    expect(JSON.parse(String(row['Observed feature explanations']))).toEqual(report.guidance[0].observedFeatures);
    delete caller.callerContext;
    expect(callerContextReport(caller)).toMatchObject({ state: 'not_recorded', diagnostics: null });
    expect(callerContextCsv(caller).rows).toHaveLength(1);
    caller.callerContext = emptyCallerContext('unavailable');
    expect(callerContextCsv(caller).rows[0][4]).toBe('unavailable');
});
