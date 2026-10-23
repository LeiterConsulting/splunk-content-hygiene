import { analyzeInventory, RawAnalysisSource } from '../services/analysis';
import { buildCoverageResolver, CoverageContext } from '../services/dependencyCoverage';
import { parseDataModel, parseSpl } from '../services/dependencyParser';
import { attachReviewEvidence, compareReviewEvidence, configurationFingerprint } from '../services/reviewEvidence';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { ContentObject, ReviewRecord, ScanSummary } from '../types';

const collectors = Object.fromEntries(['apps', 'macros', 'dashboards', 'lookup_definitions', 'lookup_files',
    'saved_searches', 'data_models', 'indexes', 'sourcetypes'].map((name) => [name, true]));
const completeness = { macros: true, lookup_definitions: true, lookup_files: true, saved_searches: true,
    data_models: true, indexes: true, sourcetypes: false };
const context: CoverageContext = { collectors, gaps: [], privateObjects: [], identityKnown: true };
const now = '2026-07-28T12:00:00Z';
const scan: ScanSummary = { scanId: 'scoped', scanType: 'full', status: 'succeeded', startedAt: now,
    completedAt: now, objectCount: 5, edgeCount: 0, findingCount: 0, candidateCount: 0, warningCount: 0,
    warnings: [], errors: [], collectorCounts: {}, collectorTotals: {}, analysisStatus: 'complete', dataSource: 'live' };

function object(name: string, app = 'one', type = 'Macro', sharing = 'app'): ContentObject {
    return { objectId: `${type}::${app}::${name}`, canonicalName: name, name, objectType: type,
        app, sharing, owner: 'analyst', enabled: true, scheduled: false, updated: null,
        lastUsed: null, usageEvidence: null, healthStatus: 'unknown', abandonmentConfidence: null,
        removalImpact: 0, inboundReferences: 0, outboundReferences: 0, protected: false, evidence: [], suggestedAction: 'Review',
        configurationFingerprint: configurationFingerprint({ definition: '' }, { app, owner: 'analyst', sharing,
            perms: { read: ['user'], write: ['admin'] } }),
    };
}
const parents = [object('one', 'one', 'App'), object('two', 'two', 'App'), object('three', 'three', 'App')];
function saved(value: ContentObject): ReviewRecord {
    return { objectId: value.objectId, objectName: value.name, canonicalName: value.canonicalName,
        objectType: value.objectType, app: value.app, owner: value.owner, healthStatusAtReview: 'unknown',
        usageCoverageAtReview: null, usageLastObservedAtReview: null, usageObservationCountAtReview: null,
        usageRunIdAtReview: null, stage: 'retain', note: 'Retain this decision', assignedTo: 'team',
        scanId: scan.scanId, createdAt: now, updatedAt: now, updatedBy: 'reviewer',
        evidenceBaseline: { capturedAt: now, capturedBy: 'reviewer', evidence: value.reviewEvidence! } };
}
async function analyze(objects: ContentObject[], sources: RawAnalysisSource[], overrides: Partial<CoverageContext> = {}) {
    const analysis = analyzeInventory([...objects, ...parents], sources, completeness);
    const enriched = await attachReviewEvidence(analysis.objects, analysis.edges, {
        scanId: scan.scanId, observedAt: now, principal: 'operator', roles: ['operator'], mode: 'full',
        collectionComplete: true, analysisComplete: analysis.parserWarnings.length === 0, collectors,
        coverageContext: { ...context, gaps: analysis.coverageGaps, ...overrides },
    });
    return { ...analysis, objects: enriched, byId: new Map(enriched.map((row) => [row.objectId, row])) };
}

test('an index wildcard does not invalidate unrelated macro coverage, even in the same app', async () => {
    const source = object('source'); const local = object('local'); const remote = object('remote', 'two');
    const result = await analyze([source, local, remote], [{ objectId: source.objectId, kind: 'spl', text: 'index=*', sourceLocation: 'search' }]);
    const value = result.byId.get(local.objectId)!;
    expect(value.reviewEvidence?.coverage?.inbound.status).toBe('complete');
    expect(compareReviewEvidence(saved(value), value, { ...scan, analysisStatus: 'partial', status: 'partial' }).status).toBe('current');
    expect(result.byId.get(source.objectId)?.reviewEvidence?.coverage?.outbound.status).toBe('partial');
});

test('unknown runtime references affect compatible app-only targets locally and exported targets globally', async () => {
    const source = object('source'); const local = object('local'); const remote = object('remote', 'two');
    const exported = object('global', 'two', 'Macro', 'global');
    const result = await analyze([source, local, remote, exported], [{ objectId: source.objectId, kind: 'spl', text: '| map search="index=example"', sourceLocation: 'search' }]);
    expect(result.byId.get(local.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
    expect(result.byId.get(remote.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('complete');
    expect(result.byId.get(exported.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
    expect(result.byId.get(exported.objectId)?.reviewEvidence?.coverage?.inbound.sourceObjectIds).toEqual([source.objectId]);
});

test('private sources stay uncertain without persisting private names or owners', async () => {
    const local = object('local'); const remote = object('remote', 'two'); const exported = object('global', 'two', 'Macro', 'global');
    const result = await analyze([local, remote, exported], [], { privateObjects: [{ app: 'one', collector: 'saved_searches', count: 2 }] });
    expect(result.byId.get(local.objectId)?.reviewEvidence?.coverage?.inbound.sourceCount).toBe(2);
    expect(result.byId.get(local.objectId)?.reviewEvidence?.coverage?.inbound.sourceObjectIds).toEqual([]);
    expect(result.byId.get(remote.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('complete');
    expect(result.byId.get(exported.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
});

test('missing source catalogs remain unverified across apps; unrelated target catalogs do not poison every object', async () => {
    const target = object('target', 'two');
    const partial = await analyze([target], [], { collectors: { ...collectors, macros: false } });
    expect(partial.byId.get(target.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
    const unrelated = await analyze([target], [], { collectors: { ...collectors, lookup_files: false } });
    expect(unrelated.byId.get(target.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('complete');
});

test('ambiguous named references do not invalidate every other target of that type', async () => {
    const source = object('source'); const a = object('same', 'two', 'Macro', 'global');
    const b = object('same', 'three', 'Macro', 'global'); const other = object('other', 'two', 'Macro', 'global');
    const result = await analyze([source, a, b, other], [{ objectId: source.objectId, kind: 'spl', text: '`same`', sourceLocation: 'search' }]);
    expect(result.byId.get(a.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
    expect(result.byId.get(b.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
    expect(result.byId.get(other.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('complete');
    expect(result.byId.get(source.objectId)?.reviewEvidence?.coverage?.outbound.status).toBe('partial');
});

test('excluded private targets are not asserted missing or resolved through a shadowed global object', () => {
    const source = object('source'); const global = object('same(1)', 'two', 'Macro', 'global');
    const analysis = analyzeInventory([source, global, ...parents], [{ objectId: source.objectId, kind: 'spl', text: '`same(arg)`', sourceLocation: 'search' }], completeness, undefined,
        { privateObjects: [{ app: 'one', collector: 'macros', count: 1 }], privateTargets: [{ collector: 'macros', app: 'one', name: 'same(1)' }] });
    expect(analysis.edges.find((edge) => edge.relation === 'uses')?.resolved).toBe(false);
    expect(analysis.findings.some((finding) => finding.findingType === 'repair_required')).toBe(false);
    expect(analysis.coverageGaps.some((gap) => gap.targetName === 'same')).toBe(true);
});

test('configuration can be known while returned access evidence remains unavailable', async () => {
    const target = { ...object('target'), configurationFingerprint: configurationFingerprint({ definition: '' }, {}) };
    const result = await analyze([target], []);
    const value = result.byId.get(target.objectId)!;
    expect(value.reviewEvidence?.coverage?.configuration.status).toBe('complete');
    expect(value.reviewEvidence?.coverage?.access.status).toBe('unavailable');
    const record = saved(value); const original = JSON.stringify(record);
    expect(compareReviewEvidence(record, value, scan).status).toBe('cannot_verify');
    expect(JSON.stringify(record)).toBe(original);
});

test('unmodeled dashboard inbound navigation is not presented as complete coverage', async () => {
    const target = object('view', 'one', 'Dashboard'); const result = await analyze([target], []);
    expect(result.byId.get(target.objectId)?.reviewEvidence?.coverage?.inbound.status).toBe('partial');
});

test('legacy unscoped baselines remain visible but cannot acquire Current silently', async () => {
    const target = object('target'); const result = await analyze([target], []); const value = result.byId.get(target.objectId)!;
    const record = saved(value); record.evidenceBaseline!.evidence = { ...value.reviewEvidence!, version: 1, coverage: undefined };
    expect(compareReviewEvidence(record, value, scan).status).toBe('cannot_verify');
    expect(record.stage).toBe('retain');
    expect(compareReviewEvidence(record, value, scan).limitations.join(' ')).toMatch(/Legacy evidence/);
});

test('object-scoped Current does not relax environment-wide removal-impact blockers', async () => {
    const source = object('source'); const target = object('target', 'two');
    const result = await analyze([source, target], [{ objectId: source.objectId, kind: 'spl', text: 'index=*', sourceLocation: 'search' }]);
    const value = result.byId.get(target.objectId)!; const record = { ...saved(value), stage: 'confirmed_eligible' as const };
    const partial = { ...scan, status: 'partial' as const, analysisStatus: 'partial' as const };
    expect(compareReviewEvidence(record, value, partial).status).toBe('current');
    expect(analyzeRemovalImpact(value, result.objects, result.edges, [record], partial).readiness).toBe('blocked');
});

test('an unknown scanning identity cannot establish scoped completeness', () => {
    const target = object('target');
    const coverage = buildCoverageResolver({ ...context, identityKnown: false })(target, [], true);
    expect(coverage.outbound.status).toBe('partial'); expect(coverage.inbound.status).toBe('partial');
});

test('data-model constraints, base searches and lookup calculations expose static dependencies', () => {
    const parsed = parseDataModel(JSON.stringify({ objects: [{ constraints: [{ search: 'index=events `base`' }],
        baseSearch: '| savedsearch "baseline"', calculations: [
            { calculationType: 'Lookup', lookupName: 'catalog' },
            { calculationType: 'Eval', expression: 'lookup("aliases", json_object("key", key))' },
        ] }] }));
    expect(parsed.references.map((row) => [row.targetType, row.targetName])).toEqual([
        ['saved_search', 'baseline'], ['index', 'events'], ['macro', 'base'], ['lookup', 'catalog'], ['lookup', 'aliases'],
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(parseDataModel('{').gaps?.[0].targets).toBe('all');
});

test('dynamic lookup names cover both definition and file possibilities without poisoning other types', () => {
    expect(parseSpl('| inputlookup $table$').gaps?.map((gap) => gap.targets)).toEqual([['lookup', 'lookup_file']]);
    expect(parseSpl('index=*').gaps?.map((gap) => gap.targets)).toEqual([['index']]);
});
