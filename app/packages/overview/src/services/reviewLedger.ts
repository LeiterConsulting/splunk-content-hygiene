/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import { evidenceDigest } from './evidenceDigest';

export type RawReview = Record<string, unknown>;
export interface EvidenceReference {
    revision: string;
    number: number;
    slot: 'capture' | 'origin' | 'history';
    index?: number;
}
export interface ReviewRevisionHeader {
    _key: string;
    version: 1;
    object_id: string;
    revision_number: number;
    parent_revision: string | null;
    origin_digest: string | null;
    operation: 'save' | 'remove';
    updated_at: string;
    updated_by: string;
}
export interface ReviewRevision extends ReviewRevisionHeader {
    request_id: string;
    record: RawReview;
    baseline_ref: EvidenceReference | null;
    history_refs: EvidenceReference[];
    origin_record?: RawReview;
    capture?: unknown;
    _user?: string;
}

export function canonicalReviewId(value: string): string {
    return value.replace(/^(?:report|alert)::/, 'saved_search::');
}

export function revisionKey(objectId: string, revision: number): string {
    return `review-r1-${evidenceDigest([canonicalReviewId(objectId), revision])}`;
}

export function legacyRevisionId(record: RawReview): string {
    // Include unknown legacy fields so an old client/administrator changing the
    // original cannot silently fork or replace the accepted review lineage.
    return `legacy-r1-${evidenceDigest(record)}`;
}

export function validReference(value: unknown): value is EvidenceReference {
    if (!value || typeof value !== 'object') { return false; }
    const ref = value as EvidenceReference;
    return /^review-r1-[a-f\d]{64}$/.test(ref.revision) &&
        Number.isSafeInteger(ref.number) && ref.number >= 1 &&
        ['capture', 'origin', 'history'].includes(ref.slot) &&
        (ref.slot !== 'history' || (Number.isSafeInteger(ref.index) && ref.index! >= 0));
}

export function validateHeader(value: unknown): asserts value is ReviewRevisionHeader {
    if (!value || typeof value !== 'object') { throw new Error('Invalid review revision header.'); }
    const row = value as ReviewRevisionHeader;
    if (row.version !== 1 || typeof row.object_id !== 'string' ||
        row.object_id !== canonicalReviewId(row.object_id) ||
        !Number.isSafeInteger(row.revision_number) || row.revision_number < 1 ||
        row._key !== revisionKey(row.object_id, row.revision_number) ||
        !['save', 'remove'].includes(row.operation) ||
        typeof row.updated_at !== 'string' || typeof row.updated_by !== 'string' ||
        !(row.origin_digest === null || /^legacy-r1-[a-f\d]{64}$/.test(row.origin_digest)) ||
        row.parent_revision !== (row.revision_number === 1
            ? row.origin_digest : revisionKey(row.object_id, row.revision_number - 1))) {
        throw new Error('Review revision integrity could not be verified. No decision will be overwritten.');
    }
}

export function validateRevision(value: unknown): asserts value is ReviewRevision {
    validateHeader(value);
    const row = value as ReviewRevision;
    if (typeof row.request_id !== 'string' || !row.request_id ||
        !row.record || typeof row.record !== 'object' || Array.isArray(row.record) ||
        canonicalReviewId(String(row.record.object_id)) !== row.object_id ||
        !(row.baseline_ref === null || validReference(row.baseline_ref)) ||
        !Array.isArray(row.history_refs) || row.history_refs.length > 5 ||
        !row.history_refs.every(validReference) ||
        (row.revision_number === 1 && row.origin_digest !== null &&
            (!row.origin_record || legacyRevisionId(row.origin_record) !== row.origin_digest))) {
        throw new Error('Review revision payload could not be verified. No decision will be overwritten.');
    }
    const refs = [row.baseline_ref, ...row.history_refs].filter(
        (ref): ref is EvidenceReference => ref !== null,
    );
    refs.forEach((ref) => {
        // Evidence may only point to the same or an earlier revision in this
        // object's chain. It cannot import another object's private decision.
        if (ref.number > row.revision_number ||
            ref.revision !== revisionKey(row.object_id, ref.number)) {
            throw new Error('Review evidence points outside its revision lineage.');
        }
    });
}

export function selectRevisionHeads(values: unknown[]): Map<string, ReviewRevisionHeader> {
    const byObject = new Map<string, ReviewRevisionHeader[]>();
    values.forEach((value) => {
        validateHeader(value);
        const list = byObject.get(value.object_id) ?? [];
        list.push(value);
        byObject.set(value.object_id, list);
    });
    const heads = new Map<string, ReviewRevisionHeader>();
    byObject.forEach((rows, id) => {
        rows.sort((a, b) => a.revision_number - b.revision_number);
        const origin = rows[0].origin_digest;
        if (rows.some((row, index) => row.revision_number !== index + 1 ||
            row.origin_digest !== origin)) {
            throw new Error('Review history has a missing or inconsistent revision. Restore the app-local ledger before changing decisions.');
        }
        heads.set(id, rows[rows.length - 1]);
    });
    return heads;
}

export function evidenceFromReference(
    ref: EvidenceReference | null,
    documents: Map<string, ReviewRevision>,
): unknown {
    if (!ref) { return null; }
    const source = documents.get(ref.revision);
    if (!source) { throw new Error('A retained review evidence revision is unavailable. No decision will be overwritten.'); }
    if (ref.slot === 'capture') {
        if (!source.capture) { throw new Error('A retained review evidence capture is missing. No decision will be overwritten.'); }
        return source.capture;
    }
    if (ref.slot === 'origin') {
        if (!source.origin_record?.evidence_baseline) { throw new Error('A retained legacy evidence baseline is missing. No decision will be overwritten.'); }
        return source.origin_record.evidence_baseline;
    }
    const history = source.origin_record?.evidence_history;
    if (!Array.isArray(history) || ref.index! >= history.length) {
        throw new Error('A legacy review evidence history reference is invalid.');
    }
    return history[ref.index!];
}

export function hydrateReview(
    revision: ReviewRevision,
    documents: Map<string, ReviewRevision>,
): RawReview {
    validateRevision(revision);
    return { ...revision.record,
        evidence_baseline: evidenceFromReference(revision.baseline_ref, documents),
        evidence_history: revision.history_refs.map((ref) => evidenceFromReference(ref, documents)),
    };
}

export function prepareRevision({
    objectId, previous, legacy, record, capture, remove = false, now, actor, requestId,
}: {
    objectId: string;
    previous: ReviewRevision | null;
    legacy: RawReview | null;
    record: RawReview;
    capture?: unknown;
    remove?: boolean;
    now: string;
    actor: string;
    requestId: string;
}): ReviewRevision {
    const id = canonicalReviewId(objectId);
    const number = (previous?.revision_number ?? 0) + 1;
    if (!Number.isSafeInteger(number)) { throw new Error('Review revision limit reached.'); }
    const key = revisionKey(id, number);
    let baselineRef = previous?.baseline_ref ?? null;
    let historyRefs = [...(previous?.history_refs ?? [])];
    if (!previous && legacy) {
        baselineRef = legacy.evidence_baseline ? { revision: key, number, slot: 'origin' } : null;
        historyRefs = Array.isArray(legacy.evidence_history)
            ? legacy.evidence_history.map((_, index) => ({ revision: key, number, slot: 'history' as const, index })) : [];
    }
    if (capture !== undefined) {
        if (baselineRef) { historyRefs.push(baselineRef); }
        baselineRef = { revision: key, number, slot: 'capture' };
    }
    if (historyRefs.length > 5) { historyRefs = [historyRefs[0], ...historyRefs.slice(-4)]; }
    const cleanRecord = { ...Object.fromEntries(Object.entries(record).filter(
        ([name]) => !['_key', '_user', 'evidence_baseline', 'evidence_history'].includes(name),
    )), updated_at: now, updated_by: actor };
    const origin = previous?.origin_digest ?? (legacy ? legacyRevisionId(legacy) : null);
    return {
        _key: key, version: 1, object_id: id, revision_number: number,
        parent_revision: previous?._key ?? origin, origin_digest: origin,
        operation: remove ? 'remove' : 'save', updated_at: now, updated_by: actor,
        request_id: requestId, record: cleanRecord,
        baseline_ref: baselineRef, history_refs: historyRefs,
        ...(!previous && legacy ? { origin_record: legacy } : {}),
        ...(capture !== undefined ? { capture } : {}),
    };
}
