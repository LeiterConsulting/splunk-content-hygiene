// Synthetic unit-test contracts only. Never imported by the application bundle.
import {
    ContentObject,
    DependencyEdge,
    InventorySnapshot,
    ReviewRecord,
    UsageEvidence,
} from '../types';

export const now = Date.parse('2026-10-25T12:00:00Z');
export function object(id: string, type = 'Macro'): ContentObject {
    return {
        objectId: id,
        canonicalName: id,
        name: id,
        objectType: type,
        app: 'example',
        owner: 'reviewer',
        sharing: 'app',
        enabled: true,
        scheduled: false,
        updated: null,
        lastUsed: null,
        usageEvidence: null,
        healthStatus: 'dormant',
        abandonmentConfidence: 40,
        removalImpact: 10,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: [],
        suggestedAction: 'Investigate',
        inventoryScanId: 'scan-fixture',
    };
}
export function edge(sourceId: string, targetId: string, relation = 'uses_macro'): DependencyEdge {
    return {
        edgeId: `${sourceId}:${relation}:${targetId}`,
        sourceId,
        targetId,
        relation,
        confidence: 'high',
        evidence: 'Static unit-test reference',
        resolved: true,
        sourceLocation: 'definition',
    };
}
export function review(id: string, changes: Partial<ReviewRecord> = {}): ReviewRecord {
    return {
        objectId: id,
        objectName: id,
        canonicalName: id,
        objectType: 'Macro',
        app: 'example',
        owner: 'reviewer',
        healthStatusAtReview: 'dormant',
        usageCoverageAtReview: null,
        usageLastObservedAtReview: null,
        usageObservationCountAtReview: null,
        usageRunIdAtReview: null,
        stage: 'retain',
        note: 'Original rationale',
        assignedTo: 'original-team',
        scanId: 'scan-fixture',
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        updatedBy: 'reviewer',
        revisionId: 'revision-1',
        revisionNumber: 1,
        ...changes,
    };
}
export function usage(changes: Partial<UsageEvidence> = {}): UsageEvidence {
    return {
        usageRunId: 'usage-fixture',
        inventoryScanId: 'scan-fixture',
        sourceId: 'search_audit',
        sourceLabel: 'Search audit fixture',
        activityKind: 'saved_search_execution',
        windowDays: 30,
        windowStart: '2026-09-25T11:00:00Z',
        windowEnd: '2026-10-25T11:00:00Z',
        coverage: 'complete',
        coverageStart: '2026-09-25T11:00:00Z',
        coverageEnd: '2026-10-25T11:00:00Z',
        sourceEventCount: 5,
        observationCount: 5,
        successfulCount: 3,
        failedCount: 1,
        skippedCount: 1,
        lastObserved: '2026-10-25T10:00:00Z',
        evidence: [],
        ...changes,
    };
}
export function snapshot(
    objects: ContentObject[],
    edges: DependencyEdge[] = [],
): InventorySnapshot {
    return {
        objects,
        edges,
        findings: [],
        owners: [],
        usage: {
            runId: 'usage-fixture',
            inventoryScanId: 'scan-fixture',
            status: 'succeeded',
            startedAt: '2026-10-25T11:00:00Z',
            completedAt: '2026-10-25T11:01:00Z',
            windowDays: 30,
            windowStart: '2026-09-25T11:00:00Z',
            windowEnd: '2026-10-25T11:00:00Z',
            coverage: 'complete',
            eligibleObjectCount: objects.length,
            fullyCoveredObjectCount: objects.length,
            observedObjectCount: 1,
            warningCount: 0,
            warnings: [],
            sources: [],
            matchesCurrentInventory: true,
        },
        scan: {
            scanId: 'scan-fixture',
            scanType: 'full',
            status: 'succeeded',
            startedAt: '2026-10-25T11:00:00Z',
            completedAt: '2026-10-25T11:01:00Z',
            objectCount: objects.length,
            edgeCount: edges.length,
            findingCount: 0,
            candidateCount: objects.length,
            warningCount: 0,
            warnings: [],
            errors: [],
            collectorCounts: {},
            collectorTotals: {},
            analysisStatus: 'complete',
            dataSource: 'live',
        },
    };
}
