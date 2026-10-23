import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
    ConfigurationFingerprint,
    ContentObject,
    DependencyEdge,
    ObjectReviewEvidence,
    ReviewEvidenceBaseline,
    ReviewRecord,
    ReviewRelationshipEvidence,
    ScanSummary,
} from '../types';
import { buildDependencyIndex, DependencyIndex } from './dependencyGraph';
import { evidenceWindowFresh, usageValidity } from './usage';

// Full adjacency is hashed, but only this many rows travel with each durable review.
export const REVIEW_RELATIONSHIP_LIMIT = 200;
export type ReviewValidity = 'current' | 'needs_review' | 'cannot_verify' | 'unreviewed';
export interface ReviewRelationshipChange {
    kind: 'new' | 'no_longer_observed' | 'changed';
    before: ReviewRelationshipEvidence | null;
    after: ReviewRelationshipEvidence | null;
}
export interface ReviewFreshness {
    status: ReviewValidity;
    reasons: string[];
    limitations: string[];
    relationships: ReviewRelationshipChange[];
    comparedScanId: string | null;
    baseline: ReviewEvidenceBaseline | null;
    current: ObjectReviewEvidence | null;
    diffTruncated: boolean;
}
export const reviewValidityLabels: Record<ReviewValidity, string> = {
    current: 'Current',
    needs_review: 'Needs re-review',
    cannot_verify: 'Cannot verify',
    unreviewed: 'Not reviewed',
};

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, canonical(item)]),
        );
    }
    return value;
}

export function evidenceDigest(value: unknown): string {
    return bytesToHex(sha256(utf8ToBytes(JSON.stringify(canonical(value)))));
}

const operationalFields = new Set([
    'next_scheduled_time',
    'triggered_alert_count',
    'qualifiedSearch',
    'currentDBSizeMB',
    'totalEventCount',
    'maxTime',
    'minTime',
    'bucketCount',
    'isReady',
    'isOnline',
    'last_update',
    'last_successful_update',
]);

function dataModelDefinition(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return value; }
    const model = value as Record<string, unknown>;
    if (!Array.isArray(model.objects)) { return value; }
    return { ...model, objects: model.objects.map((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { return item; }
        const object = item as Record<string, unknown>;
        if (!Array.isArray(object.calculations)) { return item; }
        return { ...object, calculations: object.calculations.map((calculation: unknown) => {
            if (!calculation || typeof calculation !== 'object' || Array.isArray(calculation)) { return calculation; }
            // The REST handler regenerates editor calculation IDs on reads.
            // Expressions, output fields, type, ownership and all other fields remain compared.
            return Object.fromEntries(Object.entries(calculation).filter(([key]) => key !== 'calculationID'));
        }) };
    }) };
}

// Fingerprint returned configuration, not collection times or runtime counters.
// No raw SPL, XML, lookup rows, role grants, or credentials are retained here.
export function configurationFingerprint(
    content: Record<string, unknown>,
    acl: Record<string, unknown>,
    collectorId?: string,
): ConfigurationFingerprint {
    // Configuration names such as dispatch.earliest_time must be values, not
    // nested document keys: KV Store batch_save rejects dotted/dollar keys.
    const fields: ConfigurationFingerprint['fields'] = [];
    Object.keys(content)
        .sort()
        .forEach((key) => {
            if (
                (key.startsWith('eai:') && key !== 'eai:data') ||
                key.startsWith('update.') ||
                operationalFields.has(key)
            ) {
                return;
            }
            let value = content[key];
            // The supported macro config endpoint returns 0/1 where the legacy
            // admin handler returns booleans. These are the same configuration.
            if (key === 'iseval' && ['0', '1', 'false', 'true'].includes(String(value).toLowerCase())) {
                value = ['1', 'true'].includes(String(value).toLowerCase());
            }
            // Dashboard Studio and data-model definitions may be JSON strings.
            if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
                try {
                    value = JSON.parse(value);
                } catch {
                    /* XML, SPL and plain text stay exact. */
                }
            }
            if (collectorId === 'data_models' && key === 'description') {
                value = dataModelDefinition(value);
            }
            fields.push({ name: key, digest: evidenceDigest(value) });
        });
    const perms =
        acl.perms && typeof acl.perms === 'object' ? (acl.perms as Record<string, unknown>) : {};
    const roles = (value: unknown): string[] => {
        if (Array.isArray(value)) {
            return value.map(String).sort();
        }
        return typeof value === 'string' ? value.split(',').sort() : [];
    };
    return {
        version: 1,
        digest: evidenceDigest(fields),
        fields,
        accessDigest: evidenceDigest({
            app: acl.app ?? null,
            owner: acl.owner ?? null,
            sharing: acl.sharing ?? null,
            read: roles(perms.read),
            write: roles(perms.write),
        }),
    };
}

export interface ReviewEvidenceScope {
    scanId: string;
    observedAt: string;
    principal: string;
    roles: string[];
    mode: string;
    collectionComplete: boolean;
    analysisComplete: boolean;
    collectors: Record<string, boolean>;
}

function relationshipEvidence(
    center: ContentObject,
    edge: DependencyEdge,
    index: DependencyIndex,
): ReviewRelationshipEvidence {
    const direction = edge.sourceId === center.objectId ? 'outbound' : 'inbound';
    const id = direction === 'outbound' ? edge.targetId : edge.sourceId;
    const neighbor = index.objects.get(id);
    return {
        key: evidenceDigest([edge.sourceId, edge.targetId, edge.relation]),
        direction,
        objectId: id,
        name: neighbor?.name ?? id,
        relation: edge.relation,
        confidence: edge.confidence,
        resolved: edge.resolved,
        sourceLocation: edge.sourceLocation,
        evidenceDigest: evidenceDigest(edge.evidence),
        neighborDigest: neighbor?.configurationFingerprint
            ? evidenceDigest([
                  neighbor.configurationFingerprint.digest,
                  neighbor.configurationFingerprint.accessDigest,
              ])
            : null,
    };
}

function objectEvidence(
    object: ContentObject,
    index: DependencyIndex,
    scope: ReviewEvidenceScope,
    scopeDigest: string,
): ObjectReviewEvidence | undefined {
    if (!object.configurationFingerprint) {
        return undefined;
    }
    const adjacent = [
        ...(index.inbound.get(object.objectId) ?? []),
        ...(index.outbound.get(object.objectId) ?? []),
    ];
    const relationships = [
        ...new Map(
            adjacent.map((edge) => {
                const row = relationshipEvidence(object, edge, index);
                return [row.key, row] as const;
            }),
        ).values(),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const limitations = [
        ...(!scope.collectionComplete ? ['Collector visibility is incomplete or bounded.'] : []),
        ...(!scope.analysisComplete ? ['Dependency parsing has declared coverage gaps.'] : []),
        ...(object.analysisWarnings ?? []),
        ...(relationships.some((row) => !row.resolved || !row.neighborDigest)
            ? ['One or more adjacent objects are unresolved or lack configuration fingerprints.']
            : []),
    ];
    return {
        version: 1,
        objectId: object.objectId,
        scanId: scope.scanId,
        observedAt: scope.observedAt,
        configuration: object.configurationFingerprint,
        owner: object.owner,
        sharing: object.sharing,
        objectType: object.objectType,
        enabled: object.enabled,
        scheduled: object.scheduled,
        protected: object.protected,
        relationshipDigest: evidenceDigest(relationships),
        relationshipCount: relationships.length,
        relationships: relationships.slice(0, REVIEW_RELATIONSHIP_LIMIT),
        relationshipsTruncated: relationships.length > REVIEW_RELATIONSHIP_LIMIT,
        scopeDigest,
        coverageComplete: limitations.length === 0,
        limitations,
    };
}

export async function attachReviewEvidence(
    objects: ContentObject[],
    edges: DependencyEdge[],
    scope: ReviewEvidenceScope,
): Promise<ContentObject[]> {
    const index = buildDependencyIndex(objects, edges);
    const scopeDigest = evidenceDigest({
        principal: scope.principal,
        roles: [...scope.roles].sort(),
        mode: scope.mode,
        collectionComplete: scope.collectionComplete,
        analysisComplete: scope.analysisComplete,
        collectors: scope.collectors,
    });
    const result: ContentObject[] = [];
    /* eslint-disable no-await-in-loop -- Yield between chunks to keep scan progress and cancellation responsive. */
    for (let start = 0; start < objects.length; start += 200) {
        result.push(
            ...objects.slice(start, start + 200).map((object) => ({
                ...object,
                reviewEvidence: objectEvidence(object, index, scope, scopeDigest),
            })),
        );
        if (start + 200 < objects.length) {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        }
    }
    /* eslint-enable no-await-in-loop */
    return result;
}

function supportedEvidence(value: unknown): value is ObjectReviewEvidence {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const item = value as ObjectReviewEvidence;
    const hash = (digest: unknown): boolean =>
        typeof digest === 'string' && /^[a-f\d]{64}$/.test(digest);
    return (
        item.version === 1 &&
        typeof item.objectId === 'string' &&
        typeof item.objectType === 'string' &&
        typeof item.protected === 'boolean' &&
        (item.owner === null || typeof item.owner === 'string') &&
        (item.sharing === null || typeof item.sharing === 'string') &&
        (item.enabled === null || typeof item.enabled === 'boolean') &&
        (item.scheduled === null || typeof item.scheduled === 'boolean') &&
        typeof item.scanId === 'string' &&
        typeof item.observedAt === 'string' &&
        item.configuration?.version === 1 &&
        hash(item.configuration.digest) &&
        hash(item.configuration.accessDigest) &&
        Array.isArray(item.configuration.fields) &&
        item.configuration.fields.every((field) => field && typeof field.name === 'string' && hash(field.digest)) &&
        hash(item.relationshipDigest) &&
        hash(item.scopeDigest) &&
        Number.isSafeInteger(item.relationshipCount) &&
        item.relationshipCount >= 0 &&
        typeof item.relationshipsTruncated === 'boolean' &&
        typeof item.coverageComplete === 'boolean' &&
        Array.isArray(item.limitations) &&
        item.limitations.every((message) => typeof message === 'string') &&
        Array.isArray(item.relationships) &&
        item.relationships.length <= REVIEW_RELATIONSHIP_LIMIT &&
        item.relationshipCount >= item.relationships.length &&
        item.relationships.every(
            (row) =>
                row &&
                hash(row.key) &&
                typeof row.objectId === 'string' &&
                typeof row.name === 'string' &&
                typeof row.relation === 'string' &&
                typeof row.resolved === 'boolean' &&
                ['inbound', 'outbound'].includes(row.direction) &&
                ['high', 'medium', 'low', 'unknown'].includes(row.confidence) &&
                (row.sourceLocation === null || typeof row.sourceLocation === 'string') &&
                hash(row.evidenceDigest) &&
                (row.neighborDigest === null || hash(row.neighborDigest)),
        )
    );
}

// Treat unrecognized/invalid legacy evidence as absent; never bless it as current.
export function parseReviewBaseline(value: unknown): ReviewEvidenceBaseline | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const baseline = value as ReviewEvidenceBaseline;
    return typeof baseline.capturedAt === 'string' &&
        typeof baseline.capturedBy === 'string' &&
        supportedEvidence(baseline.evidence)
        ? baseline
        : null;
}

export function compareReviewEvidence(
    review: ReviewRecord | null | undefined,
    object: ContentObject | null | undefined,
    scan: ScanSummary | null | undefined,
    now = Date.now(),
): ReviewFreshness {
    const baseline = parseReviewBaseline(review?.evidenceBaseline);
    const result: ReviewFreshness = {
        status: review ? 'cannot_verify' : 'unreviewed',
        reasons: [],
        limitations: [],
        relationships: [],
        comparedScanId: scan?.scanId ?? null,
        baseline,
        diffTruncated: false,
        current: supportedEvidence(object?.reviewEvidence) ? object.reviewEvidence : null,
    };
    if (!review) {
        result.reasons.push('No saved review decision to compare.');
        return result;
    }
    if (!scan) {
        result.reasons.push('Current inventory is unavailable or still loading. Object absence cannot be determined.');
        return result;
    }
    if (!object) {
        result.reasons.push(
            'Object is no longer observed in the current inventory; removal is not proven.',
        );
        return result;
    }
    const current = object.reviewEvidence;
    if (!baseline || baseline.evidence.objectId !== object.objectId) {
        result.reasons.push(
            'This review has no supported evidence baseline. Its saved decision is unchanged.',
        );
        return result;
    }
    if (!supportedEvidence(current) || current.scanId !== scan.scanId) {
        result.reasons.push(
            'Current inventory has no comparable fingerprint. Run a complete scan.',
        );
        return result;
    }
    const before = baseline.evidence;
    const currentUsageValidity = usageValidity(object, scan.scanId, now);
    if (baseline.usageAtCapture) {
        if (
            baseline.usageAtCapture.coverage !== 'complete' ||
            currentUsageValidity !== 'current' ||
            object.usageEvidence?.coverage !== 'complete'
        ) {
            result.limitations.push(
                'Usage supporting the captured review is incomplete, historical, or no longer current.',
            );
        }
        if (
            currentUsageValidity === 'current' &&
            object.usageEvidence &&
            (object.usageEvidence.coverage !== baseline.usageAtCapture.coverage ||
                object.usageEvidence.windowDays < baseline.usageAtCapture.windowDays ||
                (baseline.usageAtCapture.observationCount > 0 &&
                    object.usageEvidence.observationCount === 0))
        ) {
            result.reasons.push(
                'Usage coverage/window changed or previously observed activity is no longer in the current window; inactivity is not proven.',
            );
        }
    }
    if (
        currentUsageValidity === 'current' &&
        object.usageEvidence &&
        object.usageEvidence.observationCount > 0 &&
        (!baseline.usageAtCapture ||
            baseline.usageAtCapture.observationCount === 0 ||
            Date.parse(object.usageEvidence.lastObserved ?? '') > Date.parse(baseline.capturedAt))
    ) {
        result.reasons.push(
            'Attributable usage is now observed or occurred after the evidence baseline was captured.',
        );
    }
    if (before.configuration.digest !== current.configuration.digest) {
        const oldFields = new Map(before.configuration.fields.map((field) => [field.name, field.digest]));
        const newFields = new Map(current.configuration.fields.map((field) => [field.name, field.digest]));
        const keys = [...new Set([...oldFields.keys(), ...newFields.keys()])]
            .filter((key) => oldFields.get(key) !== newFields.get(key));
        result.reasons.push(
            `Configuration changed${keys.length ? `: ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ` (+${keys.length - 12} more)` : ''}` : ''}.`,
        );
    }
    if (
        before.configuration.accessDigest !== current.configuration.accessDigest ||
        before.owner !== current.owner ||
        before.sharing !== current.sharing
    ) {
        result.reasons.push(
            `Owner, sharing, or ACL permissions changed (owner: ${before.owner ?? 'shared/unknown'} → ${current.owner ?? 'shared/unknown'}; sharing: ${before.sharing ?? 'unknown'} → ${current.sharing ?? 'unknown'}).`,
        );
    }
    if (
        before.objectType !== current.objectType ||
        before.enabled !== current.enabled ||
        before.scheduled !== current.scheduled ||
        before.protected !== current.protected
    ) {
        result.reasons.push('Object type, enabled/scheduled state, or protection changed.');
    }
    if (before.scopeDigest !== current.scopeDigest) {
        result.reasons.push('Collector scope, scanning identity/roles, or coverage changed.');
    }
    if (before.relationshipDigest !== current.relationshipDigest) {
        result.reasons.push(
            `Relationships or adjacent-object configuration changed (${before.relationshipCount} → ${current.relationshipCount} captured relationships).`,
        );
        const oldRows = new Map(before.relationships.map((row) => [row.key, row]));
        const newRows = new Map(current.relationships.map((row) => [row.key, row]));
        current.relationships.forEach((after) => {
            const old = oldRows.get(after.key);
            if (!old) {
                result.relationships.push({ kind: 'new', before: null, after });
            } else if (evidenceDigest(old) !== evidenceDigest(after)) {
                result.relationships.push({ kind: 'changed', before: old, after });
            }
        });
        before.relationships.forEach((old) => {
            if (!newRows.has(old.key)) {
                result.relationships.push({ kind: 'no_longer_observed', before: old, after: null });
            }
        });
        result.diffTruncated = before.relationshipsTruncated || current.relationshipsTruncated;
        // A row outside a compact manifest is not proof of a newly added/lost relationship.
        if (result.diffTruncated) {
            result.relationships = result.relationships.filter((row) => row.kind === 'changed');
            result.limitations.push(
                'Full adjacency fingerprints differ. Compact manifests retain 200 rows each; additions/losses beyond those rows cannot be identified exactly.',
            );
        }
    }
    result.limitations.push(
        ...before.limitations.map((message) => `At baseline: ${message}`),
        ...current.limitations.map((message) => `Now: ${message}`),
    );
    if (scan.retainedBaseline) {
        result.limitations.push(
            'The latest check did not replace the retained inventory baseline.',
        );
    }
    if (
        !evidenceWindowFresh(scan.completedAt ?? scan.startedAt, now) ||
        !evidenceWindowFresh(current.observedAt, now)
    ) {
        result.limitations.push(
            'Inventory evidence is older than seven days or its timestamp is invalid.',
        );
    }
    const complete =
        before.coverageComplete &&
        current.coverageComplete &&
        scan.analysisStatus === 'complete' &&
        scan.status === 'succeeded' &&
        result.limitations.length === 0;
    result.status = complete ? 'current' : 'cannot_verify';
    if (result.reasons.length) {
        result.status = 'needs_review';
    }
    if (!result.reasons.length) {
        result.reasons.push(
            complete
                ? 'Recorded configuration, access, and relationships match the reviewed baseline.'
                : 'No change found in comparable evidence, but coverage does not establish review validity.',
        );
    }
    return result;
}
