/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import {
    analyzeInventory,
    extractDashboardReferences,
    extractSplReferences,
} from '../services/analysis';
import { parseDashboard, parseSpl } from '../services/dependencyParser';
import { applyUsageEvidence, usageEvidenceState, usageValidity } from '../services/usage';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { canonicalObjectId, normalizeObjectEntry } from '../services/inventory';
import { canonicalReviewId } from '../services/reviews';
import { ContentObject, ScanSummary, UsageEvidence } from '../types';

const coverage = {
    macros: true,
    lookup_definitions: true,
    lookup_files: true,
    saved_searches: true,
    data_models: true,
    indexes: true,
    sourcetypes: true,
};
function object(
    id: string,
    type = 'Macro',
    name = id,
    overrides: Partial<ContentObject> = {},
): ContentObject {
    return {
        objectId: id,
        canonicalName: name,
        name,
        objectType: type,
        app: 'search',
        owner: 'analyst',
        sharing: 'app',
        enabled: true,
        scheduled: false,
        updated: '2026-01-01T00:00:00Z',
        lastUsed: null,
        usageEvidence: null,
        healthStatus: 'unknown',
        abandonmentConfidence: 0,
        removalImpact: 0,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: [],
        suggestedAction: '',
        ...overrides,
    };
}

test('quoted pipes, comments, and eval assignments do not invent executable dependencies', () => {
    expect(
        extractSplReferences(
            '| makeresults | eval text="| inputlookup phantom.csv", index="fake" | eval x="`fake_macro`" ``` | lookup commented key ```',
        ),
    ).toHaveLength(0);
    expect(
        extractSplReferences('index=main [ | inputlookup hosts.csv ]').map((ref) => ref.targetName),
    ).toEqual(['main', 'hosts.csv']);
    expect(extractSplReferences('| savedsearch "Daily Report" earliest=-1d')[0].targetName).toBe(
        'Daily Report',
    );
});

test('backticks inside quoted macro arguments are literal, not nested invocations', () => {
    const result = extractSplReferences(
        '`comment("Examples: `fake_macro` and | inputlookup phantom.csv")` | savedsearch "Real Report"',
    );
    expect(result.map((reference) => reference.targetName)).toEqual(['comment', 'Real Report']);
    expect(result[0].macroArity).toBe(1);
});

test.each([
    ['error index=main', ['main']],
    ['(index=main OR index=_audit)', ['main', '_audit']],
    ['index IN (main, "_audit")', ['main', '_audit']],
    ['NOT index=retired index=main', ['main']],
    ['index=main NOT (index=retired OR index=old)', ['main']],
    ['NOT (NOT index=main) AND index!=retired', ['main']],
    ['| eval note="index=ghost" | search (index=main sourcetype="vendor(log)")', ['main', 'vendor(log)']],
    ['[search error index=_audit] index=main', ['_audit', 'main']],
])('search filter grammar retains only positive static targets: %s', (query, expected) => {
    const result = parseSpl(query as string);
    expect(result.references.map((reference) => reference.targetName)).toEqual(expected);
    expect(result.warnings).toHaveLength(0);
});

test('dynamic IN members and incomplete lists remain explicit evidence gaps', () => {
    const dynamic = parseSpl('index IN (main, $runtime$, _*)');
    expect(dynamic.references.map((reference) => reference.targetName)).toEqual(['main']);
    expect(dynamic.warnings).toEqual(expect.arrayContaining([expect.stringContaining('Dynamic index reference')]));
    expect(parseSpl('index IN (main').warnings).toEqual(expect.arrayContaining([expect.stringContaining('unterminated index IN list')]));
    expect(parseSpl('index=').warnings).toEqual(expect.arrayContaining([expect.stringContaining('Missing index reference')]));
});

test('a leading command macro retains following static index filters', () => {
    expect(parseSpl('| `base_search` index=main').references.map((reference) => reference.targetName)).toEqual(['base_search', 'main']);
});

test('Studio JSON is parsed before decoding quotes, and malformed sources are explicit', () => {
    const source = JSON.stringify({
        dataSources: {
            main: {
                type: 'ds.search',
                options: { query: 'index="main" | lookup "hosts.csv" host' },
            },
        },
    });
    expect(extractDashboardReferences(source).map((ref) => ref.targetName)).toEqual([
        'main',
        'hosts.csv',
    ]);
    expect(parseDashboard('{bad json').warnings).toContain(
        'Dashboard JSON could not be parsed; dependencies are incomplete',
    );
});

test('REST-wrapped Studio definitions and chained SPL retain their real dependencies', () => {
    const source = JSON.stringify({
        dataSources: {
            base: { type: 'ds.search', options: { query: 'index="main"' } },
            chain: {
                type: 'ds.chain',
                options: { extend: 'base', query: '| lookup hosts.csv host' },
            },
        },
    });
    const result = parseDashboard(
        `<dashboard version="2"><definition><![CDATA[${source}]]></definition></dashboard>`,
    );
    expect(result.warnings).toHaveLength(0);
    expect(result.references.map((reference) => reference.targetName)).toEqual([
        'main',
        'hosts.csv',
    ]);
    expect(parseDashboard('<dashboard version="2"/>').warnings).toContain(
        'Dashboard Studio definition is missing or is not JSON',
    );
    expect(extractSplReferences('$entire_query$')).toHaveLength(0);
    expect(parseSpl('$entire_query$').warnings).toEqual([
        expect.stringContaining('Dynamic SPL command or query'),
    ]);
    expect(extractSplReferences('| inputlookup start = 10 max=50 hosts.csv')[0].targetName).toBe(
        'hosts.csv',
    );
});

test('macro arity and export visibility select the applicable target', () => {
    const src = object('source', 'Saved Search');
    const objects = [
        src,
        object('zero', 'Macro', 'm'),
        object('one', 'Macro', 'm(1)'),
        object('foreign', 'Macro', 'private_app_macro', { app: 'other' }),
    ];
    const result = analyzeInventory(
        objects,
        [
            {
                objectId: src.objectId,
                kind: 'spl',
                text: '`m("a,b")` `private_app_macro`',
                sourceLocation: 'search',
            },
        ],
        coverage,
    );
    expect(result.edges).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ targetId: 'one', resolved: true }),
            expect.objectContaining({
                targetId: expect.stringContaining('missing::macro'),
                resolved: false,
                confidence: 'unknown',
            }),
        ]),
    );
});

test('configuration edges connect app membership and backing lookup files with evidence', () => {
    const result = analyzeInventory(
        [
            object('app', 'App', 'search'),
            object('definition', 'Lookup Definition', 'hosts'),
            object('file', 'Lookup File', 'hosts.csv'),
        ],
        [{ objectId: 'definition', kind: 'lookup', text: 'hosts.csv', sourceLocation: 'filename' }],
        coverage,
    );
    expect(result.edges).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: 'definition',
                targetId: 'file',
                relation: 'uses_file',
                confidence: 'high',
            }),
            expect.objectContaining({
                sourceId: 'definition',
                targetId: 'app',
                relation: 'belongs_to',
            }),
        ]),
    );
});

test('lookup commands can name CSV files directly without a lookup definition', () => {
    const result = analyzeInventory(
        [object('search', 'Saved Search'), object('file', 'Lookup File', 'hosts.csv')],
        [
            {
                objectId: 'search',
                kind: 'spl',
                text: '| lookup hosts.csv host',
                sourceLocation: 'search',
            },
        ],
        coverage,
    );
    expect(result.edges).toEqual([
        expect.objectContaining({ sourceId: 'search', targetId: 'file', resolved: true }),
    ]);
});

test('scheduling does not detach reviews and scan keys are immutable', () => {
    const collector = {
        id: 'saved_searches',
        label: 'Saved searches',
        endpoint: 'saved/searches',
        objectType: 'Saved Search',
    };
    const entry = {
        name: 'Daily',
        acl: { app: 'search', owner: 'analyst', sharing: 'app' },
        content: { is_scheduled: false },
    };
    const first = normalizeObjectEntry(entry, collector, 'scan-a', '2026-07-28T12:00:00Z');
    const second = normalizeObjectEntry(
        { ...entry, content: { is_scheduled: true } },
        collector,
        'scan-b',
        '2026-07-28T12:00:00Z',
    );
    expect(first.object_id).toBe(second.object_id);
    expect(first._key).not.toBe(second._key);
    expect(canonicalObjectId('Alert', 'search', 'Daily')).toBe(first.object_id);
    expect(canonicalReviewId('report::search::Daily')).toBe(first.object_id);
});

test('all consumers reject evidence before modification, from an old inventory, or expired', () => {
    const usage: UsageEvidence = {
        usageRunId: 'usage',
        inventoryScanId: 'current',
        sourceId: 'dashboard_access',
        sourceLabel: 'Web',
        activityKind: 'dashboard_view',
        windowDays: 90,
        windowStart: '2026-04-29T00:00:00Z',
        windowEnd: '2026-07-28T10:00:00Z',
        coverage: 'complete',
        coverageStart: '2026-04-29T00:00:00Z',
        coverageEnd: '2026-07-28T10:00:00Z',
        sourceEventCount: 100,
        observationCount: 0,
        successfulCount: 0,
        failedCount: 0,
        skippedCount: 0,
        lastObserved: null,
        evidence: [],
    };
    const dashboard = object('dashboard', 'Dashboard', 'Dashboard', {
        updated: '2026-07-28T11:00:00Z',
    });
    const applied = applyUsageEvidence(
        [dashboard],
        [],
        [{ objectId: dashboard.objectId, usage }],
        'current',
    ).objects[0];
    expect(usageValidity(applied)).toBe('modified');
    expect(usageEvidenceState(applied)).toBe('historical');
    const scan: ScanSummary = {
        scanId: 'current',
        scanType: 'full',
        status: 'succeeded',
        startedAt: '2026-07-28T12:00:00Z',
        completedAt: '2026-07-28T12:00:00Z',
        objectCount: 1,
        edgeCount: 0,
        findingCount: 0,
        candidateCount: 0,
        warningCount: 0,
        warnings: [],
        errors: [],
        collectorCounts: {},
        collectorTotals: {},
        analysisStatus: 'complete',
        dataSource: 'live',
    };
    const review = {
        objectId: 'dashboard',
        stage: 'confirmed_eligible',
        note: 'Owner approved investigation',
    };
    expect(analyzeRemovalImpact(applied, [applied], [], [review as never], scan).readiness).toBe(
        'confirmation_required',
    );
    expect(usageValidity({ ...applied, updated: null, inventoryScanId: 'different' })).toBe(
        'historical',
    );
    expect(
        usageValidity({ ...applied, updated: null }, 'current', Date.parse('2026-08-08T12:00:00Z')),
    ).toBe('expired');
});
