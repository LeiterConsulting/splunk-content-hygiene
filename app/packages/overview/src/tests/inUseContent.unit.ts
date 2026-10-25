import { buildInUseReport, InUseOptions, inUsePath } from '../services/inUseContent';
import { edge, now, object, review, snapshot, usage } from './milestoneFixtures';

const options: InUseOptions = { activity: 'all', includeRetained: true, successfulOnly: false };
test('unions current activity and explicit Retain roots, following macro/lookup/file closure across apps', () => {
    const report = object('report', 'Report');
    report.usageEvidence = usage();
    const objects = [
        report,
        object('retained'),
        object('macro'),
        object('lookup', 'Lookup definition'),
        { ...object('file', 'Lookup file'), app: 'another-app' },
    ];
    const result = buildInUseReport(
        snapshot(objects, [
            edge('report', 'macro'),
            edge('macro', 'lookup'),
            edge('lookup', 'file', 'uses_file'),
            edge('retained', 'macro'),
        ]),
        [review('retained')],
        options,
        now,
    );
    expect(result.rows.map((row) => row.objectId).sort()).toEqual([
        'file',
        'lookup',
        'macro',
        'report',
        'retained',
    ]);
    expect(result.rootCount).toBe(2);
    expect(result.rows.find((row) => row.objectId === 'file')?.via?.depth).toBe(3);
    expect(result.rows.find((row) => row.objectId === 'retained')?.reasons[0]).toMatchObject({
        kind: 'retained',
        reviewer: 'reviewer',
        evidenceStatus: 'cannot_verify',
    });
    expect(inUsePath(result, 'file').ids).toEqual(['report', 'macro', 'lookup', 'file']);
});
test('does not collapse duplicate names, count archived Retain decisions, or infer an app-wide retain rule', () => {
    const objects = [
        { ...object('a'), name: 'Same', app: 'a' },
        { ...object('b'), name: 'Same', app: 'b' },
        object('app', 'App'),
    ];
    const result = buildInUseReport(
        snapshot(objects, [edge('a', 'app', 'belongs_to')]),
        [review('a'), review('b', { removed: true })],
        options,
        now,
    );
    expect(result.rows.map((row) => row.objectId)).toEqual(['a']);
    expect(result.relationships).toHaveLength(0);
});
test.each(['expired', 'inventory', 'modified', 'run', 'window', 'unavailable'] as const)(
    'does not silently reuse invalid %s usage as current activity',
    (kind) => {
        const used = object('used', 'Report');
        used.usageEvidence = usage();
        if (kind === 'expired') {
            used.usageEvidence.windowEnd = '2026-10-01T11:00:00Z';
        }
        if (kind === 'inventory') {
            used.usageEvidence.inventoryScanId = 'older-scan';
        }
        if (kind === 'modified') {
            used.updated = '2026-10-25T11:30:00Z';
        }
        if (kind === 'run') {
            used.usageEvidence.usageRunId = 'older-run';
        }
        if (kind === 'window') {
            used.usageEvidence.windowStart = '2026-09-24T11:00:00Z';
        }
        if (kind === 'unavailable') {
            used.usageEvidence.coverage = 'unavailable';
        }
        expect(buildInUseReport(snapshot([used]), [], options, now).rows).toHaveLength(0);
    },
);
test('partial positive observations remain distinct from complete coverage and successful executions', () => {
    const used = object('used', 'Report');
    used.usageEvidence = usage({ coverage: 'partial', successfulCount: 0 });
    const input = snapshot([used]);
    input.usage!.coverage = 'partial';
    expect(buildInUseReport(input, [], options, now).rootCount).toBe(1);
    expect(buildInUseReport(input, [], { ...options, successfulOnly: true }, now).rootCount).toBe(
        0,
    );
    expect(buildInUseReport(input, [], options, now).gaps.join(' ')).toMatch(/partial/);
});
test('activity kinds are explicit and Retain stays independent of observations', () => {
    const search = object('search', 'Saved Search');
    search.usageEvidence = usage();
    const dashboard = object('dashboard', 'Dashboard');
    dashboard.usageEvidence = usage({ activityKind: 'dashboard_view' });
    const result = buildInUseReport(
        snapshot([search, dashboard]),
        [review('search')],
        { ...options, activity: 'dashboard_view' },
        now,
    );
    expect(result.rootCount).toBe(2);
    expect(
        result.rows.find((row) => row.objectId === 'search')?.reasons.map((reason) => reason.kind),
    ).toEqual(['retained']);
});
test('exports the source window and retains mapping and source warnings even for a complete window', () => {
    const used = object('used', 'Report');
    used.usageEvidence = usage();
    const input = snapshot([used]);
    input.usage!.warnings = ['7 activity rows could not be mapped uniquely.'];
    input.usage!.sources = [
        {
            sourceId: 'audit',
            label: 'Search audit',
            activityKind: 'saved_search_execution',
            coverage: 'complete',
            coverageStart: input.usage!.windowStart,
            coverageEnd: input.usage!.windowEnd,
            sourceEventCount: 100,
            activityRecordCount: 9,
            matchedObjectCount: 1,
            truncated: true,
            warning: 'Unmapped activity remains unverified',
        },
    ];
    const result = buildInUseReport(input, [], options, now);
    expect(result.rootCount).toBe(1);
    expect(result.usage).toEqual(input.usage);
    expect(result.gaps.join(' ')).toMatch(/7 activity rows could not be mapped uniquely/);
    expect(result.gaps.join(' ')).toMatch(
        /Search audit: complete usage coverage; activity results truncated; Unmapped activity remains unverified/,
    );
    input.usage!.sources[0].truncated = false;
    input.usage!.warnings = ['Search audit: Unmapped activity remains unverified'];
    expect(
        buildInUseReport(input, [], options, now).gaps.filter((gap) =>
            gap.includes('Unmapped activity remains unverified'),
        ),
    ).toHaveLength(1);
});
test('unverified reviews cannot supply Retain roots, while missing retained identities remain explicit', () => {
    expect(buildInUseReport(snapshot([]), [review('missing')], options, now, false).rootCount).toBe(
        0,
    );
    const result = buildInUseReport(snapshot([]), [review('missing')], options, now);
    expect(result.rows[0].inInventory).toBe(false);
    expect(result.gaps.join(' ')).toMatch(/not in the current inventory/);
});
test('records unresolved references and never claims complete migration coverage', () => {
    const input = snapshot([object('a')], [{ ...edge('a', 'missing'), resolved: false }]);
    const result = buildInUseReport(input, [], { ...options, selectedIds: ['a'] }, now);
    expect(result.rows.find((row) => row.objectId === 'missing')?.inInventory).toBe(false);
    expect(result.coverage).toBe('partial');
    expect(result.gaps.join(' ')).toMatch(/Automatic lookups/);
    expect(result.gaps.join(' ')).toMatch(/unresolved/);
});
test('cycles, diamonds and multiple roots terminate with one deduplicated shortest witness', () => {
    const result = buildInUseReport(
        snapshot(
            ['a', 'b', 'c', 'd'].map((id) => object(id)),
            [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('d', 'a')],
        ),
        [],
        { ...options, selectedIds: ['a', 'c'] },
        now,
    );
    expect(result.rows).toHaveLength(4);
    expect(result.relationships).toHaveLength(5);
    expect(result.rows.find((row) => row.objectId === 'd')?.via?.depth).toBe(1);
});
test('low witness confidence propagates through later high-confidence edges', () => {
    const input = snapshot(
        ['a', 'b', 'c'].map((id) => object(id)),
        [{ ...edge('a', 'b'), confidence: 'low' }, edge('b', 'c')],
    );
    expect(
        buildInUseReport(input, [], { ...options, selectedIds: ['a'] }, now).rows.find(
            (row) => row.objectId === 'c',
        )?.via?.confidence,
    ).toBe('low');
});
test('explicit empty selection never invents a default root', () => {
    expect(
        buildInUseReport(
            snapshot([object('a')]),
            [review('a')],
            { ...options, selectedIds: [] },
            now,
        ).rows,
    ).toHaveLength(0);
});
test('object and edge truncation, and missing manifest edges, are disclosed', () => {
    const input = snapshot(
        ['a', 'b', 'c'].map((id) => object(id)),
        [edge('a', 'b'), edge('b', 'c')],
    );
    const limited = buildInUseReport(
        input,
        [],
        { ...options, selectedIds: ['a'], maxObjects: 2 },
        now,
    );
    expect(limited.truncated).toBe(true);
    expect(limited.rows).toHaveLength(2);
    expect(limited.gaps.join(' ')).toMatch(/Traversal limit/);
    expect(
        buildInUseReport(input, [], { ...options, selectedIds: ['a'], maxEdges: 1 }, now).truncated,
    ).toBe(true);
    expect(buildInUseReport({ ...input, edges: [] }, [], options, now).gaps.join(' ')).toMatch(
        /manifest/,
    );
});
test('12,000-hop closure is iterative and only path presentation is bounded', () => {
    const objects = Array.from({ length: 12000 }, (_, index) => object(`node-${index}`));
    const edges = objects
        .slice(1)
        .map((item, index) => edge(objects[index].objectId, item.objectId));
    const result = buildInUseReport(
        snapshot(objects, edges),
        [],
        { ...options, selectedIds: ['node-0'] },
        now,
    );
    expect(result.rows).toHaveLength(12000);
    expect(result.truncated).toBe(false);
    expect(inUsePath(result, 'node-11999')).toMatchObject({ truncated: true });
    expect(inUsePath(result, 'node-11999').ids).toHaveLength(100);
});
