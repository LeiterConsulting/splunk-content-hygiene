export type AppPage =
    | 'overview'
    | 'cleanup-candidates'
    | 'dependency-explorer'
    | 'in-use-content'
    | 'review-library'
    | 'ownership'
    | 'settings';

export type HealthStatus =
    'active' | 'dormant' | 'orphaned' | 'broken' | 'unowned' | 'protected' | 'unknown';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export type UsageCoverage = 'complete' | 'partial' | 'unavailable';

export type UsageWindowDays = 30 | 90 | 180;

export type UsageActivityKind = 'saved_search_execution' | 'dashboard_view';

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
    analysisWarnings?: string[];
    inventoryScanId?: string;
    configurationFingerprint?: ConfigurationFingerprint;
    reviewEvidence?: ObjectReviewEvidence;
    fieldLineage?: FieldLineageFacts;
}

export interface FieldScope { field: 'sourcetype' | 'host' | 'source'; value: string; exact: boolean }
export interface FieldAliasMapping { input: string; output: string; mode: 'AS' | 'ASNEW' }
export interface LookupFieldMapping { lookupField: string; eventField: string; position: number }
export interface LookupMappingFacts {
    version: 1;
    inputs: LookupFieldMapping[];
    outputs: LookupFieldMapping[];
    outputMode: 'OUTPUT' | 'OUTPUTNEW' | 'implicit';
}
/** Possible shared configuration context, never an effective-props assertion. */
export interface FieldContextEvidence {
    declaringApp: string;
    dependencyApp: string | null;
    invokingApp: string;
    declaration: 'local_candidate' | 'exported_candidate';
    dependency: 'local_candidate' | 'exported_candidate' | 'unresolved';
    selector: { field: FieldScope['field']; value: string; sourceLocation: string } | null;
}
export type FieldPhase = 'extraction' | 'alias' | 'calculated' | 'lookup';
export interface FieldOutputDeclaration {
    field: string;
    capture: number | null;
    /** Zero-based UTF-16 offset in the named native attribute, not a field value. */
    offset: number;
    attribute: 'value' | 'REGEX' | 'FORMAT' | 'FIELDS';
}
export interface ExtractionOutputProvenance {
    version: 1;
    method: 'inline_named_captures' | 'transform_named_captures' | 'transform_format' | 'transform_fields';
    sourceField: string | null;
    sourceOrigin: 'default_raw' | 'explicit_inline' | 'source_key' | 'unknown';
    regexCaptureCount: number | null;
    declarations: FieldOutputDeclaration[];
}
export interface ProducerOutputDeclaration extends FieldOutputDeclaration {
    objectId: string;
    method: ExtractionOutputProvenance['method'];
}
/** Compact declared facts only: never an expression, regex, lookup row or value. */
export interface FieldLineageFacts {
    version: 1;
    operation: 'inline' | 'report' | 'alias' | 'eval' | 'transform' | 'lookup';
    stanza: string | null;
    attribute: string | null;
    scope: FieldScope | null;
    enabled: boolean | null;
    inputs: string[];
    outputs: string[];
    aliases: FieldAliasMapping[];
    transforms: string[];
    syntax: 'declared' | 'partial' | 'unsupported';
    sourceLocation: string;
    limitations: string[];
    outputProvenance?: ExtractionOutputProvenance;
    lookupMapping?: LookupMappingFacts;
    propsContexts?: PropsContextEvidence[];
    propsContextsTruncated?: boolean;
    crossStanzaProps?: CrossStanzaPropsEvidence[];
    crossStanzaPropsTruncated?: boolean;
}
/** Native shared, exact-stanza observation, never file provenance or execution proof. */
export interface PropsContextEvidence {
    version: 1;
    objectId: string;
    app: string;
    status: 'local' | 'inherited' | 'shadowed' | 'unverified';
    selectedObjectId: string | null;
    valueDigest: string | null;
    reason: 'matched' | 'different_binding' | 'not_returned' | 'access_denied' | 'snapshot_changed' |
        'metadata_mismatch' | 'unsupported_scope' | 'budget' | 'request_failed';
    /** Numeric stanza priority from the merged metadata; null means unsupported. */
    stanzaPriority?: number | null;
}
export interface PropsEventScope {
    sourceLocation: string;
    selectors: Array<{ field: FieldScope['field']; value: string; sourceLocation: string }>;
}
/** Conditional order among captured exact stanzas, never an effective winner. */
export interface CrossStanzaPropsEvidence extends PropsEventScope {
    version: 1;
    objectId: string;
    callerObjectId: string;
    app: string;
    attribute: string;
    status: 'highest' | 'lower' | 'unverified';
    reason: 'category' | 'priority' | 'ascii' | 'single_stanza' | 'no_conjunction' | 'binding_unverified' |
        'case_ambiguous' | 'budget' | 'incomplete_catalog' | 'same_stanza_shadow';
    selectedObjectId: string | null;
    competingObjectIds: string[];
    stanzaPriority: number | null;
    selectedPriority: number | null;
}
export interface FieldDependencyProvenance {
    version: 1;
    kind: 'report_binding' | 'lookup_binding' | 'field_input' | 'event_scope';
    fields: string[];
    scope: FieldScope | null;
    consumerPhase: FieldPhase | null;
    producerPhase: FieldPhase;
    /** One-based native REPORT positions, retaining repeated targets. */
    transformPositions: number[];
    viaObjectIds: string[];
    contextApps: string[];
    invocation: 'fixed_app' | 'invoking_app_unverified';
    outputDeclarations?: ProducerOutputDeclaration[];
    contexts?: FieldContextEvidence[];
    propsContexts?: PropsContextEvidence[];
    propsContextsTruncated?: boolean;
    crossStanzaProps?: CrossStanzaPropsEvidence[];
    crossStanzaPropsTruncated?: boolean;
}

export interface ConfigurationFingerprint {
    version: 1 | 2;
    digest: string;
    fields: Array<{ name: string; digest: string }>;
    accessDigest: string;
    accessComplete?: boolean;
}

export interface EvidenceCoverageDimension {
    status: 'complete' | 'partial' | 'unavailable';
    reasons: string[];
    sourceCount: number;
    sourceObjectIds: string[];
    digest: string;
}
export interface ReviewCoverage {
    policy: 'shared-static-v1' | 'shared-static-v2' | 'shared-static-v3' | 'shared-static-v4' | 'shared-static-v5' | 'shared-static-v6' | 'shared-static-v7';
    configuration: EvidenceCoverageDimension;
    access: EvidenceCoverageDimension;
    outbound: EvidenceCoverageDimension;
    inbound: EvidenceCoverageDimension;
}

export interface ReviewRelationshipEvidence {
    key: string;
    direction: 'inbound' | 'outbound';
    objectId: string;
    name: string;
    relation: string;
    confidence: ConfidenceLevel;
    resolved: boolean;
    sourceLocation: string | null;
    evidenceDigest: string;
    neighborDigest: string | null;
}

export interface ObjectReviewEvidence {
    version: 1 | 2;
    objectId: string;
    scanId: string;
    observedAt: string;
    configuration: ConfigurationFingerprint;
    owner: string | null;
    sharing: string | null;
    objectType: string;
    enabled: boolean | null;
    scheduled: boolean | null;
    protected: boolean;
    relationshipDigest: string;
    relationshipCount: number;
    relationships: ReviewRelationshipEvidence[];
    relationshipsTruncated: boolean;
    scopeDigest: string;
    coverageComplete: boolean;
    limitations: string[];
    coverage?: ReviewCoverage;
}

export interface ReviewEvidenceBaseline {
    capturedAt: string;
    capturedBy: string;
    evidence: ObjectReviewEvidence;
    usageAtCapture?: UsageEvidence | null;
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
    fieldProvenance?: FieldDependencyProvenance;
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
    /** Normalized shared records; a tag assignment is one record. */
    collectorCounts: Record<string, number>;
    /** Native endpoint paging totals; tags are counted as stanzas here. */
    collectorTotals: Record<string, number>;
    /** Native entries (such as tag stanzas) can expand into many normalized records. */
    collectorNativeCounts?: Record<string, number>;
    collectorVersions?: Record<string, string>;
    parserCounts?: Record<string, number>;
    analysisStatus: 'pending' | 'complete' | 'partial' | 'failed';
    dataSource: 'live';
    snapshotVersion?: number;
    retainedBaseline?: boolean;
}

export interface InventorySnapshot {
    scan: ScanSummary;
    latestCheck?: ScanSummary | null;
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
    evidenceBaseline?: ReviewEvidenceBaseline | null;
    evidenceHistory?: ReviewEvidenceBaseline[];
    revisionId?: string;
    revisionNumber?: number;
    removed?: boolean;
    persistenceIssue?: string;
}

export interface ReviewHistoryEntry {
    revisionId: string;
    revisionNumber: number;
    operation: 'save' | 'remove';
    stage: string;
    note: string;
    assignedTo: string | null;
    updatedAt: string;
    updatedBy: string;
    capturedEvidence: boolean;
}
export interface ReviewHistoryPage {
    entries: ReviewHistoryEntry[];
    nextBefore: number | null;
}

export interface ReviewInput {
    object: ContentObject;
    stage: ReviewStage;
    note: string;
    assignedTo: string | null;
    scanId: string;
    captureEvidence?: boolean;
    evidence?: ObjectReviewEvidence;
    expectedUpdatedAt?: string | null;
    expectedRevisionId?: string | null;
}

export interface ReviewClient {
    isAvailable: () => boolean;
    listReviews: () => Promise<ReviewRecord[]>;
    upsertReview: (input: ReviewInput) => Promise<ReviewRecord>;
    deleteReview: (objectId: string, expectedRevisionId?: string | null) => Promise<void>;
    getReview?: (objectId: string) => Promise<ReviewRecord | null>;
    listHistory?: (objectId: string, before?: number) => Promise<ReviewHistoryPage>;
}

export interface ScanProgress {
    completedCollectors: number;
    totalCollectors: number;
    stage: string;
}

export interface InventoryClient {
    isAvailable: () => boolean;
    cancelScan?: () => void;
    getLatestSnapshot: (page?: AppPage) => Promise<InventorySnapshot | null>;
    runBoundedScan: (onProgress?: (progress: ScanProgress) => void) => Promise<InventorySnapshot>;
    runFullScan: (onProgress?: (progress: ScanProgress) => void) => Promise<InventorySnapshot>;
    runUsageScan: (
        windowDays: UsageWindowDays,
        onProgress?: (progress: ScanProgress) => void,
    ) => Promise<InventorySnapshot>;
}
