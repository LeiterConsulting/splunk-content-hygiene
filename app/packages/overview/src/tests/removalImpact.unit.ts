import { analyzeRemovalImpact } from '../services/removalImpact';
import { ContentObject, DependencyEdge, ReviewRecord, ScanSummary } from '../types';

const completeScan: ScanSummary = {
    scanId: 'scan-impact-test',
    scanType: 'full',
    status: 'succeeded',
    startedAt: '2026-07-28T12:00:00Z',
    completedAt: '2026-07-28T12:05:00Z',
    objectCount: 4,
    edgeCount: 3,
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

function contentObject(
    objectId: string,
    name: string,
    objectType: string,
    overrides: Partial<ContentObject> = {},
): ContentObject {
    return {
        objectId,
        canonicalName: name.toLowerCase().replace(/\s+/g, '_'),
        name,
        objectType,
        app: 'search',
        owner: 'analyst',
        sharing: 'app',
        enabled: true,
        scheduled: false,
        updated: '2026-07-28T11:00:00Z',
        lastUsed: null,
        healthStatus: 'active',
        abandonmentConfidence: 10,
        removalImpact: 10,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: [],
        suggestedAction: 'Review',
        ...overrides,
    };
}

function edge(
    edgeId: string,
    sourceId: string,
    targetId: string,
    relation = 'uses',
): DependencyEdge {
    return {
        edgeId,
        sourceId,
        targetId,
        relation,
        confidence: 'high',
        evidence: `${sourceId} ${relation} ${targetId}`,
        sourceLocation: 'search',
        resolved: true,
    };
}

function confirmedReview(object: ContentObject): ReviewRecord {
    return {
        objectId: object.objectId,
        objectName: object.name,
        canonicalName: object.canonicalName,
        objectType: object.objectType,
        app: object.app,
        owner: object.owner,
        healthStatusAtReview: object.healthStatus,
        stage: 'confirmed_eligible',
        note: 'Approved for controlled change planning.',
        assignedTo: 'platform-team',
        scanId: completeScan.scanId,
        createdAt: '2026-07-28T12:06:00Z',
        updatedAt: '2026-07-28T12:06:00Z',
        updatedBy: 'reviewer',
    };
}

test('calculates direct and transitive blast radius with readable paths', () => {
    const selected = contentObject('macro::search::a', 'Macro A', 'Macro', {
        inboundReferences: 1,
        outboundReferences: 1,
    });
    const direct = contentObject('saved_search::search::b', 'Saved Search B', 'Saved Search', {
        inboundReferences: 1,
        outboundReferences: 1,
    });
    const indirect = contentObject('dashboard::search::c', 'Dashboard C', 'Dashboard', {
        outboundReferences: 1,
    });
    const lookup = contentObject('lookup_definition::search::d', 'Lookup D', 'Lookup Definition', {
        inboundReferences: 1,
    });
    const analysis = analyzeRemovalImpact(
        selected,
        [selected, direct, indirect, lookup],
        [
            edge('edge-direct', direct.objectId, selected.objectId),
            edge('edge-indirect', indirect.objectId, direct.objectId, 'references'),
            edge('edge-follow-up', selected.objectId, lookup.objectId, 'reads'),
        ],
        [],
        completeScan,
        3,
    );

    expect(analysis.directDependents).toHaveLength(1);
    expect(analysis.directDependents[0]).toMatchObject({
        objectId: direct.objectId,
        depth: 1,
        direct: true,
    });
    expect(analysis.indirectDependents).toHaveLength(1);
    expect(analysis.indirectDependents[0].pathNames).toEqual([
        'Dashboard C',
        'Saved Search B',
        'Macro A',
    ]);
    expect(analysis.affectedAppCount).toBe(1);
    expect(analysis.readiness).toBe('dependencies_present');
    expect(analysis.summary).toBe('Address 1 known direct dependent before considering removal.');
    expect(analysis.dependencyFollowUps[0]).toMatchObject({
        objectId: lookup.objectId,
        potentiallyOrphaned: true,
        knownDependentCount: 1,
    });
});

test('handles dependency cycles without counting the selected object as impacted', () => {
    const selected = contentObject('macro::search::a', 'Macro A', 'Macro', {
        inboundReferences: 1,
        outboundReferences: 1,
    });
    const dependent = contentObject('saved_search::search::b', 'Saved Search B', 'Saved Search', {
        inboundReferences: 1,
        outboundReferences: 1,
    });
    const analysis = analyzeRemovalImpact(
        selected,
        [selected, dependent],
        [
            edge('edge-a', dependent.objectId, selected.objectId),
            edge('edge-b', selected.objectId, dependent.objectId),
        ],
        [],
        completeScan,
        5,
    );

    expect(analysis.affectedObjects.map(({ objectId }) => objectId)).toEqual([dependent.objectId]);
    expect(analysis.truncated).toBe(false);
});

test('blocks removal planning when protected content is in the blast radius', () => {
    const selected = contentObject('macro::search::a', 'Macro A', 'Macro', {
        inboundReferences: 1,
    });
    const protectedDashboard = contentObject(
        'dashboard::security::critical',
        'Security Overview',
        'Dashboard',
        {
            app: 'security',
            outboundReferences: 1,
            protected: true,
            healthStatus: 'protected',
        },
    );
    const analysis = analyzeRemovalImpact(
        selected,
        [selected, protectedDashboard],
        [edge('edge-protected', protectedDashboard.objectId, selected.objectId, 'references')],
        [],
        completeScan,
    );

    expect(analysis.impactLevel).toBe('critical');
    expect(analysis.protectedAffectedCount).toBe(1);
    expect(analysis.readiness).toBe('blocked');
    expect(analysis.potentialConsequences.join(' ')).toContain(
        'protected and must block routine removal planning',
    );
});

test('requires a complete scan even when the captured graph has no dependents', () => {
    const selected = contentObject('saved_search::search::a', 'Saved Search A', 'Saved Search');
    const partialScan: ScanSummary = {
        ...completeScan,
        status: 'partial',
        warningCount: 1,
        warnings: ['Saved search collector was incomplete'],
        analysisStatus: 'partial',
    };
    const analysis = analyzeRemovalImpact(
        selected,
        [selected],
        [],
        [confirmedReview(selected)],
        partialScan,
    );

    expect(analysis.impactLevel).toBe('unknown');
    expect(analysis.readiness).toBe('blocked');
    expect(analysis.caveats.join(' ')).toContain('latest scan is partial');
});

test('allows controlled change planning only after graph and review prerequisites', () => {
    const selected = contentObject('dashboard::search::a', 'Dashboard A', 'Dashboard', {
        removalImpact: 0,
    });
    const analysis = analyzeRemovalImpact(
        selected,
        [selected],
        [],
        [confirmedReview(selected)],
        completeScan,
    );

    expect(analysis.impactLevel).toBe('low');
    expect(analysis.readiness).toBe('eligible_for_change_planning');
    expect(analysis.removalPlan.find(({ phase }) => phase === 'execute')).toMatchObject({
        blocking: false,
    });
    expect(analysis.caveats[0]).toContain('read-only simulation');
});

test('honors retain decisions as explicit removal blockers', () => {
    const selected = contentObject('dashboard::search::a', 'Dashboard A', 'Dashboard', {
        removalImpact: 0,
    });
    const retainReview: ReviewRecord = {
        ...confirmedReview(selected),
        stage: 'retain',
        note: 'Owner confirmed this dashboard remains required.',
    };
    const analysis = analyzeRemovalImpact(selected, [selected], [], [retainReview], completeScan);

    expect(analysis.readiness).toBe('blocked');
    expect(analysis.summary).toContain('marks this object for retention');
    expect(analysis.removalPlan.find(({ phase }) => phase === 'execute')).toMatchObject({
        blocking: true,
    });
});
