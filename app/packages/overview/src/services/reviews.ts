/* eslint-disable no-underscore-dangle -- Splunk KV Store defines the _key protocol field. */
import { username, splunkdPath } from '@splunk/splunk-utils/config';
import { createRESTURL } from '@splunk/splunk-utils/url';
import { splunkRequest, SplunkRequestError as ReviewRequestError } from './rest';

import {
    HealthStatus,
    ReviewClient,
    ReviewInput,
    ReviewRecord,
    ReviewStage,
    UsageCoverage,
} from '../types';
import { stableRecordKey } from './inventory';
import { parseReviewBaseline } from './reviewEvidence';

const APP_ID = 'content_hygiene';
const COLLECTION = 'ch_reviews';
const PAGE_SIZE = 1000;

type JsonRecord = Record<string, unknown>;

interface KvReviewRecord extends JsonRecord {
    _key: string;
    object_id: string;
    object_name: string;
    canonical_name: string;
    object_type: string;
    app: string;
    owner: string | null;
    health_status_at_review: string;
    usage_coverage_at_review?: string | null;
    usage_last_observed_at_review?: string | null;
    usage_observation_count_at_review?: number | null;
    usage_run_id_at_review?: string | null;
    stage: string;
    note: string;
    assigned_to: string | null;
    scan_id: string;
    created_at: string;
    updated_at: string;
    updated_by: string;
}

export const reviewStageOptions: Array<{
    value: ReviewStage;
    label: string;
    description: string;
}> = [
    {
        value: 'triage',
        label: 'Triage',
        description: 'Saved for initial review and prioritization.',
    },
    {
        value: 'investigating',
        label: 'Investigating',
        description: 'Dependency, usage, and ownership evidence is under review.',
    },
    {
        value: 'awaiting_owner',
        label: 'Awaiting owner',
        description: 'An owner or subject-matter expert must confirm intent.',
    },
    {
        value: 'confirmed_eligible',
        label: 'Confirmed eligible',
        description: 'Review evidence supports eligibility for a future cleanup process.',
    },
    {
        value: 'retain',
        label: 'Retain',
        description: 'The object was reviewed and should remain in place.',
    },
    {
        value: 'blocked',
        label: 'Blocked',
        description: 'A dependency, policy, or missing evidence blocks a decision.',
    },
];

const reviewStages = new Set<ReviewStage>(reviewStageOptions.map(({ value }) => value));

const healthStatuses = new Set<HealthStatus>([
    'active',
    'dormant',
    'orphaned',
    'broken',
    'unowned',
    'protected',
    'unknown',
]);

function stringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(parsed)
        ? null
        : parsed;
}

function usageCoverageValue(value: unknown): UsageCoverage | null {
    return value === 'complete' || value === 'partial' || value === 'unavailable' ? value : null;
}

function collectionUrl(suffix = ''): string {
    return createRESTURL(`storage/collections/data/${COLLECTION}${suffix}`, {
        owner: 'nobody',
        app: APP_ID,
    });
}

function withQuery(url: string, query: Record<string, string | number>): string {
    const search = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => search.set(key, String(value)));
    return `${url}?${search.toString()}`;
}

const requestJson = splunkRequest;

export function canonicalReviewId(objectId: string): string {
    return objectId.replace(/^(?:report|alert)::/, 'saved_search::');
}

function isReviewStage(value: string): value is ReviewStage {
    return reviewStages.has(value as ReviewStage);
}

function isHealthStatus(value: string): value is HealthStatus {
    return healthStatuses.has(value as HealthStatus);
}

export function reviewRecordFromKv(record: KvReviewRecord): ReviewRecord {
    const stage = stringValue(record.stage, 'triage');
    const healthStatus = stringValue(record.health_status_at_review, 'unknown');
    return {
        objectId: canonicalReviewId(stringValue(record.object_id)),
        objectName: stringValue(record.object_name),
        canonicalName: stringValue(record.canonical_name, stringValue(record.object_name)),
        objectType: stringValue(record.object_type, 'Unknown'),
        app: stringValue(record.app, 'unknown'),
        owner: stringValue(record.owner) || null,
        healthStatusAtReview: isHealthStatus(healthStatus) ? healthStatus : 'unknown',
        usageCoverageAtReview: usageCoverageValue(record.usage_coverage_at_review),
        usageLastObservedAtReview: stringValue(record.usage_last_observed_at_review) || null,
        usageObservationCountAtReview: nullableNumber(record.usage_observation_count_at_review),
        usageRunIdAtReview: stringValue(record.usage_run_id_at_review) || null,
        stage: isReviewStage(stage) ? stage : 'triage',
        note: stringValue(record.note),
        assignedTo: stringValue(record.assigned_to) || null,
        scanId: stringValue(record.scan_id),
        createdAt: stringValue(record.created_at),
        updatedAt: stringValue(record.updated_at),
        updatedBy: stringValue(record.updated_by, 'unknown'),
        evidenceBaseline: parseReviewBaseline(record.evidence_baseline),
        evidenceHistory: Array.isArray(record.evidence_history)
            ? record.evidence_history.map(parseReviewBaseline)
                .filter((item): item is NonNullable<typeof item> => item !== null) : [],
    };
}

function recordKey(objectId: string): string {
    return stableRecordKey(objectId, 'review');
}

async function getReviewRecord(objectId: string): Promise<KvReviewRecord | null> {
    const canonical = canonicalReviewId(objectId);
    const identities = [
        ...new Set([
            canonical,
            canonical.replace(/^saved_search::/, 'report::'),
            canonical.replace(/^saved_search::/, 'alert::'),
        ]),
    ];
    const records = await requestJson<KvReviewRecord[]>(
        withQuery(collectionUrl(), {
            query: JSON.stringify({ object_id: { $in: identities } }),
            limit: 4,
        }),
    );
    if (records.length > 1) {
        throw new Error(
            'Multiple legacy reviews match this saved search. Resolve the duplicate app-local records before updating its decision.',
        );
    }
    return records[0] ?? null;
}

async function listReviews(): Promise<ReviewRecord[]> {
    const records: KvReviewRecord[] = [];
    let skip = 0;

    /* eslint-disable no-await-in-loop -- KV review records are paged to support large libraries without unbounded requests. */
    while (true) {
        const page = await requestJson<KvReviewRecord[]>(
            withQuery(collectionUrl(), {
                sort: 'updated_at:-1',
                limit: PAGE_SIZE,
                skip,
            }),
        );
        records.push(...page);
        if (page.length < PAGE_SIZE) {
            break;
        }
        skip += page.length;
    }
    /* eslint-enable no-await-in-loop */

    const grouped = new Map<string, ReviewRecord[]>();
    records
        .map(reviewRecordFromKv)
        .forEach((record) =>
            grouped.set(record.objectId, [...(grouped.get(record.objectId) ?? []), record]),
        );
    return [...grouped.values()].map((matches) =>
        matches.length === 1
            ? matches[0]
            : {
                  ...matches[0],
                  stage: 'blocked' as const,
                  note: 'Multiple legacy reviews match this identity; reconcile the original records before changing the decision.',
              },
    );
}

async function upsertReview(input: ReviewInput): Promise<ReviewRecord> {
    const now = new Date().toISOString();
    const existing = await getReviewRecord(input.object.objectId);
    if (input.expectedUpdatedAt !== undefined &&
        (existing?.updated_at ?? null) !== input.expectedUpdatedAt) {
        throw new Error('This review changed in another session. Reload the library before saving so its decision and evidence are not overwritten.');
    }
    if (input.captureEvidence && (!input.evidence ||
        input.evidence.objectId !== canonicalReviewId(input.object.objectId) ||
        input.evidence.scanId !== input.scanId)) {
        throw new Error('A current inventory fingerprint is required to capture review evidence. Run a complete scan first.');
    }
    const prior = parseReviewBaseline(existing?.evidence_baseline);
    const priorHistory = Array.isArray(existing?.evidence_history)
        ? existing.evidence_history.map(parseReviewBaseline)
            .filter((item): item is NonNullable<typeof item> => item !== null) : [];
    const history = input.captureEvidence && prior ? [...priorHistory, prior] : priorHistory;
    // Retain the first capture plus the four most recent prior captures.
    const retainedHistory = history.length > 5 ? [history[0], ...history.slice(-4)] : history;
    const record: KvReviewRecord = {
        _key: existing?._key ?? recordKey(canonicalReviewId(input.object.objectId)),
        object_id: canonicalReviewId(input.object.objectId),
        object_name: existing?.object_name ?? input.object.name,
        canonical_name: existing?.canonical_name ?? input.object.canonicalName,
        object_type: existing?.object_type ?? input.object.objectType,
        app: existing?.app ?? input.object.app,
        owner: existing ? existing.owner : input.object.owner,
        health_status_at_review: existing?.health_status_at_review ?? input.object.healthStatus,
        usage_coverage_at_review: existing ? existing.usage_coverage_at_review : input.object.usageEvidence?.coverage ?? null,
        usage_last_observed_at_review: existing ? existing.usage_last_observed_at_review : input.object.usageEvidence?.lastObserved ?? null,
        usage_observation_count_at_review: existing ? existing.usage_observation_count_at_review : input.object.usageEvidence?.observationCount ?? null,
        usage_run_id_at_review: existing ? existing.usage_run_id_at_review : input.object.usageEvidence?.usageRunId ?? null,
        stage: input.stage,
        note: input.note.trim().slice(0, 4000),
        assigned_to: input.assignedTo?.trim().slice(0, 256) || null,
        scan_id: existing?.scan_id ?? input.scanId,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        updated_by: username || 'unknown',
        evidence_baseline: input.captureEvidence
            ? { capturedAt: now, capturedBy: username || 'unknown', evidence: input.evidence,
                usageAtCapture: input.object.usageEvidence }
            : existing?.evidence_baseline ?? null,
        evidence_history: input.captureEvidence ? retainedHistory : existing?.evidence_history ?? [],
    };
    const suffix = existing ? `/${encodeURIComponent(existing._key)}` : '';
    const updateFields: JsonRecord = {};
    Object.keys(record).forEach((key) => {
        if (key !== '_key') {
            updateFields[key] = record[key];
        }
    });
    const requestRecord: JsonRecord = existing ? updateFields : record;
    await requestJson<unknown>(
        collectionUrl(suffix),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestRecord),
        },
        [200, 201],
    );
    return reviewRecordFromKv(record);
}

async function deleteReview(objectId: string): Promise<void> {
    const existing = await getReviewRecord(objectId);
    if (!existing) {
        return;
    }
    await requestJson<unknown>(
        collectionUrl(`/${encodeURIComponent(existing._key)}`),
        { method: 'DELETE' },
        [200, 204],
    );
}

export const splunkReviewClient: ReviewClient = {
    isAvailable: () => Boolean(splunkdPath),
    listReviews,
    upsertReview,
    deleteReview,
};
