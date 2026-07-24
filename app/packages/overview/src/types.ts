export type AppPage =
    | 'overview'
    | 'cleanup-candidates'
    | 'dependency-explorer'
    | 'review-library'
    | 'ownership'
    | 'settings';

export type HealthStatus =
    | 'active'
    | 'dormant'
    | 'orphaned'
    | 'broken'
    | 'unowned'
    | 'protected'
    | 'unknown';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

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

export type ScanStatus =
    | 'queued'
    | 'running'
    | 'partial'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

export interface ScanSummary {
    scanId: string;
    scanType:
        | 'bounded'
        | 'full'
        | 'incremental'
        | 'usage'
        | 'ownership'
        | 'rescore';
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
    objects: ContentObject[];
    edges: DependencyEdge[];
    findings: ContentFinding[];
    owners: OwnerSummary[];
}

export type ReviewStage =
    | 'triage'
    | 'investigating'
    | 'awaiting_owner'
    | 'confirmed_eligible'
    | 'retain'
    | 'blocked';

export interface ReviewRecord {
    objectId: string;
    objectName: string;
    canonicalName: string;
    objectType: string;
    app: string;
    owner: string | null;
    healthStatusAtReview: HealthStatus;
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
    runBoundedScan: (
        onProgress?: (progress: ScanProgress) => void
    ) => Promise<InventorySnapshot>;
    runFullScan: (
        onProgress?: (progress: ScanProgress) => void
    ) => Promise<InventorySnapshot>;
}
