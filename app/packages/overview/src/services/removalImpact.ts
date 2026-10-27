import {
    ConfidenceLevel,
    ContentObject,
    DependencyEdge,
    HealthStatus,
    ReviewRecord,
    ReviewStage,
    ScanSummary,
} from '../types';
import { evidenceWindowFresh, usageSourceForObject, usageValidity } from './usage';
import { compareReviewEvidence } from './reviewEvidence';
import { isPotentialRelation, weakestDependencyConfidence } from '../utils/dependencySemantics';
import { PolicyProtection } from './appPolicies';
import { PROPS_CONTEXT_LIMITATION } from './propsEvidence';

export type RemovalImpactLevel = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export type RemovalReadiness =
    'blocked' | 'dependencies_present' | 'confirmation_required' | 'eligible_for_change_planning';

export interface ImpactedObject {
    objectId: string;
    name: string;
    objectType: string;
    app: string;
    owner: string | null;
    healthStatus: HealthStatus;
    reviewStage: ReviewStage | null;
    depth: number;
    direct: boolean;
    relation: string;
    confidence: ConfidenceLevel;
    conditional: boolean;
    evidence: string;
    sourceLocation: string | null;
    pathObjectIds: string[];
    pathNames: string[];
    likelyOutcome: string;
    resolved: boolean;
    protected: boolean;
    fieldProvenance?: DependencyEdge['fieldProvenance'];
    fieldLineage?: ContentObject['fieldLineage'];
    policyProtection?: PolicyProtection;
}

export interface DependencyFollowUp {
    objectId: string;
    name: string;
    objectType: string;
    app: string;
    relation: string;
    confidence: ConfidenceLevel;
    evidence: string;
    knownDependentCount: number;
    potentialDependentCount: number;
    potentiallyOrphaned: boolean;
    recommendation: string;
    policyProtection?: PolicyProtection;
}

export interface RemovalPlanStep {
    sequence: number;
    phase: 'validate' | 'confirm' | 'remediate' | 'prepare' | 'execute' | 'verify';
    title: string;
    detail: string;
    objectIds: string[];
    blocking: boolean;
}

export interface RemovalImpactAnalysis {
    selectedObjectId: string;
    impactLevel: RemovalImpactLevel;
    impactScore: number | null;
    readiness: RemovalReadiness;
    readinessLabel: string;
    summary: string;
    maxDepth: number;
    truncated: boolean;
    directDependents: ImpactedObject[];
    indirectDependents: ImpactedObject[];
    affectedObjects: ImpactedObject[];
    affectedAppCount: number;
    protectedAffectedCount: number;
    policyAffectedCount: number;
    unresolvedAffectedCount: number;
    dependencyFollowUps: DependencyFollowUp[];
    potentialConsequences: string[];
    removalPlan: RemovalPlanStep[];
    caveats: string[];
    policyProtection?: PolicyProtection;
}

interface TraversalItem {
    objectId: string;
    depth: number;
    pathObjectIds: string[];
    pathNames: string[];
    conditional: boolean;
    confidence: ConfidenceLevel;
}

const MAX_AFFECTED_OBJECTS = 500;
const platformResourceTypes = new Set(['App', 'Index', 'Sourcetype']);

function clampScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function unresolvedIdentity(objectId: string): {
    name: string;
    objectType: string;
    app: string;
} {
    const parts = objectId.split('::');
    return {
        name: parts.slice(3).join('::') || objectId,
        objectType: `Unresolved ${(parts[1] ?? 'object').replace(/_/g, ' ')}`,
        app: parts[2] ?? 'unknown',
    };
}

function likelyOutcome(
    dependent: ContentObject | null,
    dependencyName: string,
    dependencyType: string,
    edge: DependencyEdge,
    depth: number,
): string {
    const dependentLabel = dependent?.objectType ?? 'Referenced object';
    if (depth > 1) {
        return `${dependentLabel} may be indirectly affected because its dependency chain reaches the selected object through ${dependencyName}.`;
    }

    switch (edge.relation) {
        case 'belongs_to':
            return `${dependentLabel} belongs to the selected app. Removing the app package can remove its bundled configuration and make this object unavailable. Local overrides, data, and external integrations still require separate review.`;
        case 'uses_file':
            return `${dependentLabel} would lose its backing lookup file; readers and writers using the definition can fail or lose enrichment.`;
        case 'uses_lookup':
            return `${dependentLabel} names this lookup definition for automatic search-time enrichment. Removing it can lose output fields or cause lookup errors when the rule executes; configuration alone does not prove execution.`;
        case 'may_apply_automatic_lookup':
            return `${dependentLabel} may lose automatically enriched fields if its events match this props rule and the lookup executes. Confirm event scope, precedence and field availability before assuming an impact.`;
        case 'may_use_lookup':
            return `${dependentLabel} may bind this lookup definition in an invoking app. Confirm the effective app namespace and overrides before assuming this is the runtime target.`;
        case 'may_use_field_transform':
            return `${dependentLabel} declares this transform in an ordered REPORT list. Removing it may change extracted fields when that scope and binding apply. Check every native list position, invoking app and override; configuration is not proof of regex matching or execution.`;
        case 'may_read_extracted_field':
        case 'may_read_aliased_field':
        case 'may_read_calculated_field':
            return `${dependentLabel} declares input field(s) ${edge.fieldProvenance?.fields.join(', ') || 'with recorded producer provenance'} that may come from this earlier field-processing definition. Removing it can change derived values or enrichment if the fields are supplied at runtime. Check exact scope, processing phase, AS/ASNEW semantics and competing definitions; no field availability is assumed.`;
        case 'may_apply_field_extraction':
        case 'may_apply_field_alias':
        case 'may_apply_calculated_field':
            return `${dependentLabel} has a positive exact event selector compatible with this field-processing scope. Removal may change available fields or derived values, but the selector alone proves neither field consumption nor execution. Validate scope, permissions, precedence and actual input/output use.`;
        case 'matches_event_type':
        case 'matches_tag':
            return `${dependentLabel} explicitly selects events through this ${dependencyType}. Removing its definition or assignment can change which events match; a configured filter is not observed execution.`;
        case 'excludes_event_type':
        case 'excludes_tag':
            return `${dependentLabel} explicitly excludes events through this ${dependencyType}. Removing it can broaden or otherwise change results; exclusion is a dependency, not proof that this object is unnecessary.`;
        case 'tags_event_type':
            return `${dependentLabel} assigns a tag to this event type. Removing the definition can remove that classification from tagged searches and data-model constraints.`;
        case 'may_match_event_type':
        case 'may_match_tag':
            return `${dependentLabel} may select events through this ${dependencyType} relationship. If the binding applies at runtime, removing it can narrow or otherwise change results. Confirm the invoking app, active state and exact field/value assignment; this is not observed execution.`;
        case 'may_exclude_event_type':
        case 'may_exclude_tag':
            return `${dependentLabel} may exclude events through this ${dependencyType} relationship. If the binding applies at runtime, removing it can broaden or otherwise change results; exclusion does not make the object unnecessary. Confirm the invoking app, active state and exact field/value assignment.`;
        case 'may_tag_event_type':
            return `${dependentLabel} may assign a tag through this event-type binding. If the binding applies at runtime, removing the definition can remove classification used by tagged searches or data-model constraints. Confirm the invoking app, active state and exact field/value assignment.`;
        case 'references':
        case 'invokes':
            return `${dependentLabel} may fail to load or execute when its ${dependencyType} reference is no longer available.`;
        case 'navigates_to':
        case 'uses_search_view':
        case 'opens_view':
            return `${dependentLabel} declares an internal view destination. Removing this view can leave an unavailable menu/workflow destination or rendering view. Confirm its exact app, inherited built-in alternatives, active state and runtime parameters; the configured link is not observed activity.`;
        case 'links_to_report':
            return `${dependentLabel} declares a report navigation entry. Removing the saved search can leave an unavailable report destination; verify the exact app/report name and rendering view before a separate approved change.`;
        case 'opens_app':
        case 'runs_in_app':
            return `${dependentLabel} declares this app as an interaction destination or workflow execution namespace. Removing it can invalidate that route or namespace. Runtime tokens and effective search dependencies require separate confirmation; no action was executed to establish this link.`;
        case 'uses':
            return `${dependentLabel} search logic may fail or change because it uses this ${dependencyType}.`;
        case 'reads':
            return `${dependentLabel} may lose lookup input or enrichment supplied by this ${dependencyType}.`;
        case 'writes':
            return `${dependentLabel} may no longer be able to write or refresh data through this ${dependencyType}.`;
        case 'searches':
            return `${dependentLabel} may fail or return incomplete results when this ${dependencyType} is unavailable.`;
        default:
            return `${dependentLabel} may fail or behave differently because the captured ${edge.relation} relationship would be broken.`;
    }
}

function typeSpecificPreparation(selected: ContentObject): string {
    switch (selected.objectType) {
        case 'Field Extraction':
        case 'Field Transform':
            return 'Inspect the exact props scope, every ordered REPORT position and declared field-output consumers. Validate effective transforms and representative read-only searches; opaque PCRE capture lineage is not established before retiring configuration through supported Splunk controls.';
        case 'Field Alias':
            return 'Confirm original and alias field consumers, exact props scope, AS replacement/removal versus ASNEW preservation, and competing aliases. A declared name does not establish field availability; migrate consumers before retiring the alias through supported Splunk controls.';
        case 'Calculated Field':
            return 'Inspect declared inputs, consumers and exact props scope. EVAL definitions run in parallel, not as a chain, and cannot depend on fields added later by lookups. Validate equivalent values with read-only searches before retiring the declaration through supported Splunk controls.';
        case 'Dashboard':
            return 'Confirm navigation links, embedded references, scheduled delivery, and owner communications before retiring the dashboard through supported Splunk controls.';
        case 'Workflow Action':
            return 'Review the declared action type, explicit search app/view or internal link, static search dependencies and unresolved runtime field tokens. Confirm event-menu applicability and owners without executing the workflow or following external destinations; perform any change through separate approved Splunk administration.';
        case 'Navigation Menu':
            return 'Review exact named views/reports, internal app routes and dynamic menu gaps. Preserve an accessible app landing path, owner approval and rollback XML before any separate approved navigation change; this app never edits or activates menu definitions.';
        case 'Saved Search':
            return 'Address dashboard and savedsearch consumers, schedules, alerts, and downstream outputs before retiring the saved search through supported Splunk controls.';
        case 'Macro':
            return 'Replace every known SPL macro invocation and search for dynamic or tokenized invocations before retiring the macro.';
        case 'Lookup Definition':
        case 'Lookup File':
            return 'Migrate lookup readers and writers together, validate field compatibility, and confirm refresh ownership before retiring the lookup.';
        case 'Automatic Lookup':
            return 'Review the props LOOKUP class and event scope, effective invoking-app definition, input/output fields, precedence and all potential callers before changing automatic enrichment through a separate approved process.';
        case 'Event Type':
            return 'Review literal inclusion and exclusion filters, tag assignments, data-model constraints, macro callers and inherited app scope. Validate replacement classification through a separate approved change with rollback; do not assume a missing usage record makes the definition unused.';
        case 'Tag Binding':
            return 'Review this exact app, tag and field/value assignment rather than every same-name tag. Check qualified and unqualified tag searches, data-model constraints, disabled overrides and the referenced event type before any separate approved change.';
        case 'Data Model':
            return 'Migrate searches, pivots, and acceleration consumers and preserve rollback details before retiring the data model.';
        case 'Index':
            return 'Treat index retirement as a separate administrative change covering ingestion, retention, data migration, searches, and rollback.';
        case 'Sourcetype':
            return 'Confirm ingestion and parsing ownership and migrate every search constraint before changing the sourcetype definition.';
        case 'App':
            return 'Inventory all app-scoped content and deployment dependencies before removing an app package from any Splunk tier.';
        default:
            return `Use the supported Splunk administration or deployment workflow for ${selected.objectType} and preserve a tested rollback path.`;
    }
}

function impactLevel(
    score: number,
    affectedCount: number,
    protectedCount: number,
    analysisComplete: boolean,
): RemovalImpactLevel {
    if (!analysisComplete && affectedCount === 0) {
        return 'unknown';
    }
    if (protectedCount > 0 || score >= 85) {
        return 'critical';
    }
    if (score >= 60) {
        return 'high';
    }
    if (score >= 30 || affectedCount > 0) {
        return 'medium';
    }
    return 'low';
}

export function analyzeRemovalImpact(
    selected: ContentObject,
    objects: ContentObject[],
    edges: DependencyEdge[],
    reviews: ReviewRecord[],
    scan: ScanSummary,
    requestedMaxDepth = 3,
    now = Date.now(),
    policies: ReadonlyMap<string, PolicyProtection> = new Map(),
): RemovalImpactAnalysis {
    const maxDepth = Math.max(1, Math.min(5, Math.round(requestedMaxDepth)));
    const objectById = new Map(
        objects.map((contentObject) => [contentObject.objectId, contentObject]),
    );
    const reviewByObject = new Map(reviews.map((review) => [review.objectId, review]));
    const inboundByTarget = new Map<string, DependencyEdge[]>();
    const inboundSourceIdsByTarget = new Map<string, Set<string>>();
    const potentialSourceIdsByTarget = new Map<string, Set<string>>();

    edges.forEach((edge) => {
        const inbound = inboundByTarget.get(edge.targetId) ?? [];
        inbound.push(edge);
        inboundByTarget.set(edge.targetId, inbound);

        const consumers = isPotentialRelation(edge.relation) ? potentialSourceIdsByTarget : inboundSourceIdsByTarget;
        const sourceIds = consumers.get(edge.targetId) ?? new Set<string>();
        sourceIds.add(edge.sourceId);
        consumers.set(edge.targetId, sourceIds);
    });

    const affectedObjects: ImpactedObject[] = [];
    const seenDepth = new Map<string, number>([[selected.objectId, 0]]);
    const queue: TraversalItem[] = [
        {
            objectId: selected.objectId,
            depth: 0,
            pathObjectIds: [selected.objectId],
            pathNames: [selected.name],
            conditional: false,
            confidence: 'high',
        },
    ];
    let truncated = false;

    while (queue.length > 0 && affectedObjects.length < MAX_AFFECTED_OBJECTS) {
        const current = queue.shift()!;
        const inboundEdges = inboundByTarget.get(current.objectId) ?? [];
        if (current.depth >= maxDepth) {
            if (
                inboundEdges.some(
                    (edge) => edge.sourceId !== selected.objectId && !seenDepth.has(edge.sourceId),
                )
            ) {
                truncated = true;
            }
        } else {
            inboundEdges.forEach((edge) => {
                const nextDepth = current.depth + 1;
                const previousDepth = seenDepth.get(edge.sourceId);
                if (
                    edge.sourceId === selected.objectId ||
                    (previousDepth !== undefined && previousDepth <= nextDepth) ||
                    affectedObjects.length >= MAX_AFFECTED_OBJECTS
                ) {
                    return;
                }

                seenDepth.set(edge.sourceId, nextDepth);
                const dependent = objectById.get(edge.sourceId) ?? null;
                const unresolved = unresolvedIdentity(edge.sourceId);
                const dependency = objectById.get(current.objectId);
                const name = dependent?.name ?? unresolved.name;
                const pathObjectIds = [edge.sourceId, ...current.pathObjectIds];
                const pathNames = [name, ...current.pathNames];
                const conditional = current.conditional || isPotentialRelation(edge.relation);
                const confidence = weakestDependencyConfidence(current.confidence, edge.confidence);
                const impacted: ImpactedObject = {
                    objectId: edge.sourceId,
                    name,
                    objectType: dependent?.objectType ?? unresolved.objectType,
                    app: dependent?.app ?? unresolved.app,
                    owner: dependent?.owner ?? null,
                    healthStatus: dependent?.healthStatus ?? 'unknown',
                    reviewStage: reviewByObject.get(edge.sourceId)?.stage ?? null,
                    depth: nextDepth,
                    direct: nextDepth === 1,
                    relation: edge.relation,
                    confidence,
                    conditional,
                    evidence: edge.evidence,
                    sourceLocation: edge.sourceLocation,
                    pathObjectIds,
                    pathNames,
                    likelyOutcome: `${conditional ? 'Potential impact only. ' : ''}${likelyOutcome(
                        dependent,
                        dependency?.name ?? current.pathNames[0],
                        dependency?.objectType ?? selected.objectType,
                        edge,
                        nextDepth,
                    )}`,
                    resolved: Boolean(dependent) && edge.resolved,
                    protected: dependent?.protected ?? false,
                    ...(policies.has(edge.sourceId) ? { policyProtection: policies.get(edge.sourceId) } : {}),
                    ...(edge.fieldProvenance ? { fieldProvenance: edge.fieldProvenance } : {}),
                    ...(dependent?.fieldLineage ? { fieldLineage: dependent.fieldLineage } : {}),
                };
                affectedObjects.push(impacted);
                queue.push({
                    objectId: edge.sourceId,
                    depth: nextDepth,
                    pathObjectIds,
                    pathNames,
                    conditional,
                    confidence,
                });
            });
        }
    }

    if (queue.length > 0 || affectedObjects.length >= MAX_AFFECTED_OBJECTS) {
        truncated = true;
    }

    affectedObjects.sort(
        (left, right) =>
            left.depth - right.depth ||
            left.app.localeCompare(right.app) ||
            left.name.localeCompare(right.name),
    );

    const directDependents = affectedObjects.filter(({ direct }) => direct);
    const indirectDependents = affectedObjects.filter(({ direct }) => !direct);
    const potentialDirectCount = directDependents.filter(({ conditional }) => conditional).length;
    const potentialIndirectCount = indirectDependents.filter(({ conditional }) => conditional).length;
    const potentialAffectedCount = potentialDirectCount + potentialIndirectCount;
    const protectedAffectedCount = affectedObjects.filter((affected) => affected.protected).length;
    const policyAffectedCount = affectedObjects.filter(affected => affected.policyProtection?.blocksCleanup).length;
    const unresolvedAffectedCount = affectedObjects.filter(({ resolved }) => !resolved).length;
    const affectedAppCount = new Set(affectedObjects.map(({ app }) => app)).size;

    const outboundEdges = edges.filter((edge) => edge.sourceId === selected.objectId);
    const dependencyFollowUps: DependencyFollowUp[] = outboundEdges.map((edge) => {
        const dependency = objectById.get(edge.targetId);
        const policy = policies.get(edge.targetId);
        const unresolved = unresolvedIdentity(edge.targetId);
        const knownDependentCount = inboundSourceIdsByTarget.get(edge.targetId)?.size ?? 0;
        const known = inboundSourceIdsByTarget.get(edge.targetId);
        const potentialDependentCount = [...(potentialSourceIdsByTarget.get(edge.targetId) ?? [])].filter((id) => !known?.has(id)).length;
        const potentiallyOrphaned =
            Boolean(dependency) &&
            knownDependentCount === 1 &&
            potentialDependentCount === 0 &&
            !isPotentialRelation(edge.relation) &&
            !policy?.blocksCleanup &&
            !platformResourceTypes.has(dependency!.objectType);
        let recommendation =
            'Retain and validate this dependency independently; removing its consumer does not establish that the dependency is unused.';
        if (!dependency) {
            recommendation =
                'Resolve this target or document the incomplete inventory before planning removal.';
        } else if (policy?.blocksCleanup) {
            recommendation = policy.detail;
        } else if (platformResourceTypes.has(dependency.objectType)) {
            recommendation =
                'Treat this shared platform resource as a separate administrative decision; do not include it in the same removal change.';
        } else if (potentialDependentCount > 0 || isPotentialRelation(edge.relation)) {
            recommendation = `${knownDependentCount} configured consumers and ${potentialDependentCount} additional potential callers are captured. Verify implicit applicability before assuming consumption or orphaning; retain and investigate this dependency separately.`;
        } else if (potentiallyOrphaned) {
            recommendation =
                'Re-scan after the selected object is retired, then independently assess whether this dependency became orphaned.';
        } else if (knownDependentCount > 1) {
            recommendation = `${knownDependentCount - 1} other known object${
                knownDependentCount === 2 ? '' : 's'
            } still depend on this object; retain it and verify those consumers.`;
        }
        return {
            objectId: edge.targetId,
            name: dependency?.name ?? unresolved.name,
            objectType: dependency?.objectType ?? unresolved.objectType,
            app: dependency?.app ?? unresolved.app,
            relation: edge.relation,
            confidence: edge.confidence,
            evidence: edge.evidence,
            knownDependentCount,
            potentialDependentCount,
            potentiallyOrphaned,
            recommendation,
            ...(policy ? { policyProtection: policy } : {}),
        };
    });

    const analysisComplete =
        scan.analysisStatus === 'complete' &&
        scan.status === 'succeeded' &&
        evidenceWindowFresh(scan.completedAt ?? scan.startedAt, now) &&
        !selected.analysisWarnings?.length;
    const highConfidenceDirect = directDependents.filter(
        ({ confidence }) => confidence === 'high',
    ).length;
    const graphScore = clampScore(
        directDependents.length * 18 +
            indirectDependents.length * 5 +
            protectedAffectedCount * 20 +
            highConfidenceDirect * 8 +
            unresolvedAffectedCount * 8 +
            (affectedAppCount > 1 ? Math.min(15, affectedAppCount * 3) : 0),
    );
    const impactScore =
        selected.removalImpact === null ? graphScore : Math.max(selected.removalImpact, graphScore);
    const computedImpactLevel = impactLevel(
        impactScore,
        affectedObjects.length,
        protectedAffectedCount + (selected.protected ? 1 : 0),
        analysisComplete,
    );
    const selectedReview = reviewByObject.get(selected.objectId);
    const selectedPolicy = policies.get(selected.objectId);
    const reviewEvidenceCurrent = compareReviewEvidence(selectedReview, selected, scan, now).status === 'current';
    const referenceCountMismatch = selected.inboundReferences > directDependents.length;
    const reviewBlocksRemoval =
        selectedReview?.stage === 'retain' || selectedReview?.stage === 'blocked' || selectedPolicy?.blocksCleanup;
    const selectedUsage = selected.usageEvidence;
    const usageMatchesInventory = usageValidity(selected, scan.scanId, now) === 'current';
    const completeUsageWindow = usageMatchesInventory && selectedUsage?.coverage === 'complete';
    const observedUsage = usageMatchesInventory && (selectedUsage?.observationCount ?? 0) > 0;
    const usageSupportsPlanning =
        (completeUsageWindow && !observedUsage) ||
        (!usageSourceForObject(selected) &&
            selectedReview?.stage === 'confirmed_eligible' &&
            reviewEvidenceCurrent &&
            Boolean(selectedReview.note?.trim()));
    const unresolvedDependencyCount = dependencyFollowUps.filter(({ objectId }) =>
        objectId.startsWith('missing::'),
    ).length;

    let readiness: RemovalReadiness;
    let readinessLabel: string;
    let summary: string;
    if (
        selected.protected ||
        protectedAffectedCount > 0 ||
        policyAffectedCount > 0 ||
        reviewBlocksRemoval ||
        !analysisComplete ||
        unresolvedAffectedCount > 0 ||
        unresolvedDependencyCount > 0 ||
        truncated
    ) {
        readiness = 'blocked';
        readinessLabel = 'Blocked by current evidence';
        if (selectedPolicy?.blocksCleanup) {
            summary = selectedPolicy.detail;
        } else if (selectedReview?.stage === 'retain') {
            summary =
                'The Review Library marks this object for retention; do not plan removal unless that reviewed decision is explicitly reconsidered.';
        } else if (selectedReview?.stage === 'blocked') {
            summary =
                'The Review Library marks this object as blocked; resolve the recorded blocker before planning removal.';
        } else {
            summary =
                'Do not plan removal until incomplete, protected, unresolved, or truncated evidence is addressed.';
        }
    } else if (directDependents.length > 0) {
        readiness = 'dependencies_present';
        readinessLabel = potentialDirectCount > 0 ? 'Potential dependencies require verification' : 'Known dependencies require remediation';
        summary = potentialDirectCount > 0
            ? `Verify ${potentialDirectCount} potential direct caller(s) and address ${directDependents.length - potentialDirectCount} supported direct configuration dependency/dependencies before considering removal. Potential matches are not confirmed consumption.`
            : `Address ${directDependents.length} known direct dependent${directDependents.length === 1 ? '' : 's'} before considering removal.`;
    } else if (
        selectedReview?.stage !== 'confirmed_eligible' ||
        !reviewEvidenceCurrent ||
        referenceCountMismatch ||
        selected.removalImpact === null ||
        !usageSupportsPlanning
    ) {
        readiness = 'confirmation_required';
        readinessLabel = 'Confirmation still required';
        if (selectedReview?.stage === 'confirmed_eligible' && !reviewEvidenceCurrent) {
            summary = 'The saved confirmation has changed or unverifiable evidence. Investigate Changes since review and explicitly reaffirm evidence before change planning.';
        } else if (observedUsage) {
            summary = `${selectedUsage?.observationCount.toLocaleString()} attributable usage observation${
                selectedUsage?.observationCount === 1 ? '' : 's'
            } occurred in the current evidence window; confirm intent and replacement plans before considering removal.`;
        } else if (!completeUsageWindow) {
            summary =
                'No direct dependents were found, but a complete usage-evidence window has not been established for the current inventory.';
        } else {
            summary =
                'No direct dependents were found in this graph, but owner, review-stage, and rollback evidence still require confirmation.';
        }
    } else {
        readiness = 'eligible_for_change_planning';
        readinessLabel = 'Eligible for controlled change planning';
        summary =
            'Known graph prerequisites are satisfied; continue only through approved change control with backup, rollback, and post-change verification.';
    }

    const potentialConsequences: string[] = [];
    if (selectedPolicy?.blocksCleanup) { potentialConsequences.push(selectedPolicy.detail); }
    if (policyAffectedCount) { potentialConsequences.push(`${policyAffectedCount} affected objects have app-policy protection or unverifiable policy scope. Resolve that separate policy reason before removal planning; it is not usage evidence or an increased dependency-impact score.`); }
    if (directDependents.length > 0) {
        potentialConsequences.push(
            potentialDirectCount > 0 ? `${directDependents.length} captured direct relationships include ${potentialDirectCount} potential implicit matches; verify them before assuming consumption.` : `${directDependents.length} object${
                directDependents.length === 1 ? '' : 's'
            } directly reference or consume the selected object.`,
        );
    }
    if (indirectDependents.length > 0) {
        potentialConsequences.push(
            potentialIndirectCount > 0 ? `${indirectDependents.length} captured indirect paths include ${potentialIndirectCount} potential implicit paths within ${maxDepth} hops; these are not proven runtime effects.` : `${indirectDependents.length} additional object${
                indirectDependents.length === 1 ? '' : 's'
            } sit on a downstream dependency path within ${maxDepth} hops.`,
        );
    }
    if (affectedAppCount > 1) {
        potentialConsequences.push(
            `${potentialAffectedCount > 0 ? 'Captured possible impact' : 'Known impact'} crosses ${affectedAppCount} app namespaces, so coordination may extend beyond the selected object's owner.`,
        );
    }
    if (protectedAffectedCount > 0) {
        potentialConsequences.push(
            `${protectedAffectedCount} affected object${
                protectedAffectedCount === 1 ? ' is' : 's are'
            } protected and must block routine removal planning.`,
        );
    }
    if (selected.protected) {
        potentialConsequences.push(
            'The selected object is protected and is not eligible for routine removal planning.',
        );
    }
    if (observedUsage) {
        potentialConsequences.push(
            `The selected object has ${selectedUsage?.observationCount.toLocaleString()} attributable usage observation${
                selectedUsage?.observationCount === 1 ? '' : 's'
            } in the current ${selectedUsage?.windowDays}-day window.`,
        );
    }
    const potentiallyOrphanedCount = dependencyFollowUps.filter(
        ({ potentiallyOrphaned }) => potentiallyOrphaned,
    ).length;
    if (potentiallyOrphanedCount > 0) {
        potentialConsequences.push(
            `${potentiallyOrphanedCount} dependency object${
                potentiallyOrphanedCount === 1 ? ' may' : 's may'
            } have no other known consumer after removal and should be reassessed in a later scan.`,
        );
    }
    if (potentialConsequences.length === 0) {
        potentialConsequences.push(
            'No affected objects were found in the captured graph, but absence of a parsed edge is not proof of zero impact.',
        );
    }

    const caveats = [
        'This is a read-only simulation from the latest persisted live scan; it does not remove or modify Splunk content.',
        PROPS_CONTEXT_LIMITATION,
        'Supported explicit relationships, literal navigation/workflow targets, event-type/tag filters and labeled potential field/props bindings are included. Dynamic menu lists, runtime namespaces/views, external/embedded links, implicit classification, opaque PCRE, unsupported expressions, effective field availability, props precedence, dynamic SPL, tokens and unobserved usage can add impact.',
    ];
    if (potentialAffectedCount > 0 || outboundEdges.some((edge) => isPotentialRelation(edge.relation))) {
        caveats.push('Potential implicit paths are possibilities, not confirmed consumers or observed execution. Verify props precedence, renames, field availability and invoking-app bindings before remediation decisions.');
    }
    if (!analysisComplete) {
        caveats.push(
            'The latest scan is partial, contains collector warnings, or has incomplete analysis.',
        );
        scan.warnings.slice(0, 5).forEach((warning) => {
            caveats.push(`Scan warning: ${warning}`);
        });
    }
    if (unresolvedDependencyCount > 0) {
        caveats.push(
            `${unresolvedDependencyCount} outbound dependency target${
                unresolvedDependencyCount === 1 ? ' is' : 's are'
            } unresolved and must be investigated before removal planning.`,
        );
    }
    if (referenceCountMismatch) {
        caveats.push(
            `The object reports ${selected.inboundReferences} inbound references but only ${directDependents.length} are available in the current graph traversal.`,
        );
    }
    if (truncated) {
        caveats.push(
            `The blast-radius traversal reached its ${maxDepth}-hop or ${MAX_AFFECTED_OBJECTS}-object limit.`,
        );
    }
    if (!selectedUsage) {
        caveats.push('No usage-evidence window has been measured for the selected object.');
    } else if (!usageMatchesInventory) {
        caveats.push(
            'The available usage evidence was collected against an earlier inventory snapshot and cannot satisfy current removal-readiness prerequisites.',
        );
    } else if (selectedUsage.coverage !== 'complete') {
        caveats.push(
            `Usage telemetry coverage is ${selectedUsage.coverage}; zero observations cannot be interpreted as inactivity.`,
        );
    } else if (observedUsage) {
        caveats.push(
            `Usage was observed as recently as ${selectedUsage.lastObserved ?? 'an unknown time'} and must be reconciled with the intended disposition.`,
        );
    }

    const removalPlan: RemovalPlanStep[] = [
        {
            sequence: 1,
            phase: 'validate',
            title: 'Refresh and validate the evidence',
            detail: 'Run a complete live scan close to the proposed change, resolve collector warnings, inspect low-confidence edges, and search for dynamic references not represented in this graph.',
            objectIds: [selected.objectId],
            blocking: !analysisComplete || truncated,
        },
        {
            sequence: 2,
            phase: 'confirm',
            title: 'Obtain owner and eligibility confirmation',
            detail: usageSupportsPlanning
                ? 'The current complete usage window contains no attributable activity. Record the accountable owner, intended disposition, business context, and confirmed-eligible review stage in the app-local Review Library.'
                : 'Establish a complete current usage window, reconcile any observed activity, and record the accountable owner, intended disposition, business context, and review stage in the app-local Review Library.',
            objectIds: [selected.objectId],
            blocking: selectedReview?.stage !== 'confirmed_eligible' || !usageSupportsPlanning,
        },
        {
            sequence: 3,
            phase: 'remediate',
            title: 'Address direct dependents first',
            detail:
                directDependents.length > 0
                    ? `${potentialDirectCount > 0 ? `First verify the ${potentialDirectCount} potential caller(s); they are not confirmed consumers. ` : ''}Address the ${directDependents.length - potentialDirectCount} supported direct configuration dependencies through separate approved change control, and validate any confirmed affected object before proceeding.`
                    : 'No direct dependents are captured; independently search for references outside the supported graph before proceeding.',
            objectIds: directDependents.map(({ objectId }) => objectId),
            blocking: directDependents.length > 0,
        },
        {
            sequence: 4,
            phase: 'remediate',
            title: 'Validate cascading and cross-app effects',
            detail:
                indirectDependents.length > 0
                    ? `Walk the ${indirectDependents.length} captured indirect impact path${indirectDependents.length === 1 ? '' : 's'} with affected app owners, verify any potential implicit hop, and confirm which complete chains require remediation.`
                    : 'No indirect impact path is captured within the selected depth; record that scope and its parser limitations.',
            objectIds: indirectDependents.map(({ objectId }) => objectId),
            blocking: protectedAffectedCount > 0 || policyAffectedCount > 0,
        },
        {
            sequence: 5,
            phase: 'prepare',
            title: 'Prepare the controlled change and rollback',
            detail: `${typeSpecificPreparation(selected)} Export this impact report, back up the relevant configuration, define success checks, and obtain the required change approval.`,
            objectIds: [selected.objectId],
            blocking: false,
        },
        {
            sequence: 6,
            phase: 'execute',
            title: 'Perform removal outside this application',
            detail: 'Use only the supported Splunk administration or deployment process during the approved window. This application intentionally provides no remove, disable, or rewrite action.',
            objectIds: [selected.objectId],
            blocking: readiness !== 'eligible_for_change_planning',
        },
        {
            sequence: 7,
            phase: 'verify',
            title: 'Re-scan, test, and reassess follow-up objects',
            detail: 'Run a new complete scan, test affected searches and dashboards, compare exported evidence, monitor errors, and independently review any dependency that now appears orphaned.',
            objectIds: dependencyFollowUps
                .filter(({ potentiallyOrphaned }) => potentiallyOrphaned)
                .map(({ objectId }) => objectId),
            blocking: false,
        },
    ];
    if (selectedPolicy?.blocksCleanup) {
        removalPlan.unshift({ sequence: 0, phase: 'confirm', title: 'Resolve app retention policy protection', detail: selectedPolicy.detail,
            objectIds: [selected.objectId], blocking: true });
    }

    return {
        selectedObjectId: selected.objectId,
        impactLevel: computedImpactLevel,
        impactScore,
        readiness,
        readinessLabel,
        summary,
        maxDepth,
        truncated,
        directDependents,
        indirectDependents,
        affectedObjects,
        affectedAppCount,
        protectedAffectedCount,
        policyAffectedCount,
        unresolvedAffectedCount,
        dependencyFollowUps,
        potentialConsequences,
        removalPlan,
        caveats,
        ...(selectedPolicy ? { policyProtection: selectedPolicy } : {}),
    };
}
