export type AppPage =
    | 'overview'
    | 'cleanup-candidates'
    | 'dependency-explorer'
    | 'review-library'
    | 'ownership'
    | 'settings';

export type HealthStatus =
    'active' | 'dormant' | 'orphaned' | 'broken' | 'unowned' | 'protected' | 'unknown';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export type UsageCoverage = 'complete' | 'partial' | 'unavailable';

export type UsageWindowDays = 30 | 90 | 180;

export type UsageActivityKind =
    'saved_search_execution' | 'dashboard_view';

export interface UsageEvidence {
    usageRunId: string;
    inventoryScanId: string;
    sourceId: string;
    sourceLabel: string;
    activityKind: UsageActivityKind;
    windowDays: UsageWindowDays;
    windowStart: string;
    windowEnd: string;
    coverage: UsageCoverage;
    coverageStart: string | null;
    coverageEnd: string | null;
    sourceEventCount: number;
    observationCount: number;
    successfulCount: number;
    failedCount: number;
    skippedCount: number;
    lastObserved: string | null;
    evidence: string[];
}

export interface UsageSourceSummary {
    sourceId: string;
    label: string;
    activityKind: UsageActivityKind;
    coverage: UsageCoverage;
    coverageStart: string | null;
    coverageEnd: string | null;
    sourceEventCount: number;
    activityRecordCount: number;
    matchedObjectCount: number;
    truncated: boolean;
    warning: string | null;
}

export interface UsageSummary {
    runId: string;
    inventoryScanId: string;
    status: ScanStatus;
    startedAt: string;
    completedAt: string | null;
    windowDays: UsageWindowDays;
    windowStart: string;
    windowEnd: string;
    coverage: UsageCoverage;
    eligibleObjectCount: number;
    fullyCoveredObjectCount: number;
    observedObjectCount: number;
    warningCount: number;
    warnings: string[];
    sources: UsageSourceSummary[];
    matchesCurrentInventory: boolean;
}

export interface ContentObject {
    objectId: string;
    canonicalName: string;
    name: string;
    objectType: string;
    app: string;
    owner: string | null;
    sharing: string | null;
    enabled: boolean | null;
    scheduled: boolean | null;
    updated: string | null;
    lastUsed: string | null;
    usageEvidence: UsageEvidence | null;
    healthStatus: HealthStatus;
    abandonmentConfidence: number | null;
    removalImpact: number | null;
    inboundReferences: number;
    outboundReferences: number;
    protected: boolean;
    evidence: string[];
    suggestedAction: string;
}

export interface DependencyEdge {
    edgeId: string;
    sourceId: string;
    targetId: string;
    relation: string;
    confidence: ConfidenceLevel;
    evidence: string;
    sourceLocation: string | null;
    resolved: boolean;
}

export interface AppComposition {
    app: string;
    objectCount: number;
    activeCount: number;
    reviewCount: number;
    concernCount: number;
    protectedCount: number;
    unknownCount: number;
    activePercent: number;
    reviewPercent: number;
    concernPercent: number;
    protectedPercent: number;
    unknownPercent: number;
}

export interface OwnerSummary {
    owner: string;
    status: 'active' | 'disabled' | 'missing' | 'shared' | 'unknown';
    objectCount: number;
    activeCount: number;
    reviewCount: number;
    unownedCount: number;
}

export type FindingType =
    | 'cleanup_candidate'
    | 'broken_reference'
    | 'unowned'
    | 'protected'
    | 'needs_review'
    | 'repair_required'
    | 'insufficient_evidence';

export interface ContentFinding {
    findingId: string;
    objectId: string;
    findingType: FindingType;
    abandonmentConfidence: number | null;
    removalImpact: number | null;
    reasons: string[];
    suggestedAction: string;
    createdAt: string | null;
}

export type ScanStatus = 'queued' | 'running' | 'partial' | 'succeeded' | 'failed' | 'cancelled';

export interface ScanSummary {
    scanId: string;
    scanType: 'bounded' | 'full' | 'incremental' | 'usage' | 'ownership' | 'rescore';
    status: ScanStatus;
    startedAt: string;
    completedAt: string | null;
    objectCount: number;
    edgeCount: number;
    findingCount: number;
    candidateCount: number | null;
    warningCount: number;
    warnings: string[];
    errors: string[];
    collectorCounts: Record<string, number>;
    collectorTotals: Record<string, number>;
    analysisStatus: 'pending' | 'complete' | 'partial' | 'failed';
    dataSource: 'live';
}

export interface InventorySnapshot {
    scan: ScanSummary;
    usage: UsageSummary | null;
    objects: ContentObject[];
    edges: DependencyEdge[];
    findings: ContentFinding[];
    owners: OwnerSummary[];
}

export type ReviewStage =
    'triage' | 'investigating' | 'awaiting_owner' | 'confirmed_eligible' | 'retain' | 'blocked';

export interface ReviewRecord {
    objectId: string;
    objectName: string;
    canonicalName: string;
    objectType: string;
    app: string;
    owner: string | null;
    healthStatusAtReview: HealthStatus;
    usageCoverageAtReview: UsageCoverage | null;
    usageLastObservedAtReview: string | null;
    usageObservationCountAtReview: number | null;
    usageRunIdAtReview: string | null;
    stage: ReviewStage;
    note: string;
    assignedTo: string | null;
    scanId: string;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
}

export interface ReviewInput {
    object: ContentObject;
    stage: ReviewStage;
    note: string;
    assignedTo: string | null;
    scanId: string;
}

export interface ReviewClient {
    isAvailable: () => boolean;
    listReviews: () => Promise<ReviewRecord[]>;
    upsertReview: (input: ReviewInput) => Promise<ReviewRecord>;
    deleteReview: (objectId: string) => Promise<void>;
}

export interface ScanProgress {
    completedCollectors: number;
    totalCollectors: number;
    stage: string;
}

export interface InventoryClient {
    isAvailable: () => boolean;
    getLatestSnapshot: () => Promise<InventorySnapshot | null>;
    runBoundedScan: (onProgress?: (progress: ScanProgress) => void) => Promise<InventorySnapshot>;
    runFullScan: (onProgress?: (progress: ScanProgress) => void) => Promise<InventorySnapshot>;
    runUsageScan: (
        windowDays: UsageWindowDays,
        onProgress?: (progress: ScanProgress) => void
    ) => Promise<InventorySnapshot>;
}
