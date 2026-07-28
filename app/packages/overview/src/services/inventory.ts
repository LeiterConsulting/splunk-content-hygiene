import { username, splunkdPath } from '@splunk/splunk-utils/config';
import { createFetchInit } from '@splunk/splunk-utils/fetch';
import { createRESTURL } from '@splunk/splunk-utils/url';

import {
    AnalysisCompleteness,
    RawAnalysisSource,
    analyzeInventory,
} from './analysis';
import {
    CollectedUsageSource,
    DASHBOARD_ACCESS_SOURCE_ID,
    SEARCH_AUDIT_SOURCE_ID,
    UsageActivityAggregate,
    applyUsageEvidence,
    buildUsageEvidence,
    sourceCoverageForWindow,
} from './usage';
import {
    ConfidenceLevel,
    ContentFinding,
    ContentObject,
    DependencyEdge,
    FindingType,
    HealthStatus,
    InventoryClient,
    InventorySnapshot,
    OwnerSummary,
    ScanProgress,
    ScanStatus,
    ScanSummary,
    UsageActivityKind,
    UsageCoverage,
    UsageEvidence,
    UsageSourceSummary,
    UsageSummary,
    UsageWindowDays,
} from '../types';

const APP_ID = 'content_hygiene';
const BOUNDED_SCAN_LIMIT = 100;
const FULL_SCAN_PAGE_SIZE = 200;
const FULL_SCAN_MAX_PER_COLLECTOR = 10000;
const LOCK_KEY = 'inventory_scan_lock';
const LOCK_TTL_MS = 30 * 60 * 1000;
const BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 4;
const SNAPSHOT_PAGE_SIZE = 1000;

type JsonRecord = Record<string, unknown>;

interface RestAcl {
    app?: string;
    owner?: string;
    sharing?: string;
}

export interface SplunkRestEntry {
    name: string;
    updated?: string;
    acl?: RestAcl;
    content?: JsonRecord;
}

interface SplunkRestResponse {
    entry?: SplunkRestEntry[];
    paging?: {
        total?: number;
    };
}

interface SplunkSearchResponse {
    results?: JsonRecord[];
    messages?: Array<{ type?: string; text?: string }>;
}

interface CollectedEntries {
    entries: SplunkRestEntry[];
    total: number;
    complete: boolean;
}

type ScanMode = 'bounded' | 'full';

interface NamespaceOptions {
    app?: string;
    owner?: string;
}

interface ObjectCollectorDefinition {
    id: string;
    label: string;
    endpoint: string;
    namespace?: NamespaceOptions;
    objectType: string;
}

interface KvScanRecord extends JsonRecord {
    scan_id: string;
    scan_type: ScanSummary['scanType'];
    status: ScanStatus;
    started_at: string;
    completed_at: string | null;
    object_count: number;
    edge_count: number;
    finding_count: number;
    warnings: string[];
    errors: string[];
    collector_counts: Record<string, number>;
    collector_totals: Record<string, number>;
    analysis_status?: string;
    inventory_scan_id?: string;
    usage_window_days?: number;
    usage_window_start?: string;
    usage_window_end?: string;
    usage_coverage?: string;
    eligible_object_count?: number;
    fully_covered_object_count?: number;
    observed_object_count?: number;
    usage_sources?: JsonRecord[];
}

interface ScanLockRecord extends JsonRecord {
    _key: string;
    scan_id: string;
    acquired_at: string;
    expires_at: string;
    owner: string;
}

interface KvObjectRecord extends JsonRecord {
    _key: string;
    object_id: string;
    name: string;
    display_name: string;
    object_type: string;
    app: string;
    owner: string | null;
    sharing: string | null;
    enabled: boolean | null;
    scheduled: boolean | null;
    created: null;
    updated: string | null;
    last_used: string | null;
    inbound_references: number;
    outbound_references: number;
    health_status: HealthStatus;
    abandonment_confidence: number | null;
    removal_impact: number | null;
    protected: boolean;
    evidence: string[];
    suggested_action: string;
    source: JsonRecord;
    scan_id: string;
}

interface KvOwnerRecord extends JsonRecord {
    _key: string;
    owner: string;
    status: 'active' | 'disabled';
    roles: string[];
    object_count: number;
    active_count: number;
    review_count: number;
    unowned_count: number;
    source: JsonRecord;
    scan_id: string;
}

interface KvEdgeRecord extends JsonRecord {
    edge_id: string;
    source_id: string;
    target_id: string;
    relation: string;
    confidence: string;
    evidence: string;
    source_location: string | null;
    resolved: boolean;
    scan_id: string;
}

interface KvFindingRecord extends JsonRecord {
    finding_id: string;
    object_id: string;
    finding_type: string;
    abandonment_confidence: number | null;
    removal_impact: number | null;
    reasons: string[];
    suggested_action: string;
    created_at: string | null;
    scan_id: string;
}

interface KvUsageEvidenceRecord extends JsonRecord {
    _key: string;
    scan_id: string;
    usage_run_id: string;
    inventory_scan_id: string;
    object_id: string;
    source_id: string;
    source_label: string;
    activity_kind: string;
    window_days: number;
    window_start: string;
    window_end: string;
    coverage: string;
    coverage_start: string | null;
    coverage_end: string | null;
    source_event_count: number;
    observation_count: number;
    successful_count: number;
    failed_count: number;
    skipped_count: number;
    last_observed: string | null;
    evidence: string[];
}

interface UsageSourceDefinition {
    sourceId: string;
    label: string;
    activityKind: UsageActivityKind;
    search: (windowDays: UsageWindowDays) => string;
}

class RestRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'RestRequestError';
        this.status = status;
    }
}

const objectCollectors: ObjectCollectorDefinition[] = [
    {
        id: 'apps',
        label: 'Installed apps',
        endpoint: 'apps/local',
        objectType: 'App',
    },
    {
        id: 'saved_searches',
        label: 'Saved searches, reports, and alerts',
        endpoint: 'saved/searches',
        namespace: { owner: '-', app: '-' },
        objectType: 'Saved Search',
    },
    {
        id: 'dashboards',
        label: 'Dashboards',
        endpoint: 'data/ui/views',
        namespace: { owner: '-', app: '-' },
        objectType: 'Dashboard',
    },
    {
        id: 'macros',
        label: 'Macros',
        endpoint: 'admin/macros',
        namespace: { owner: '-', app: '-' },
        objectType: 'Macro',
    },
    {
        id: 'lookup_definitions',
        label: 'Lookup definitions',
        endpoint: 'data/transforms/lookups',
        namespace: { owner: '-', app: '-' },
        objectType: 'Lookup Definition',
    },
    {
        id: 'lookup_files',
        label: 'Lookup files',
        endpoint: 'data/lookup-table-files',
        namespace: { owner: '-', app: '-' },
        objectType: 'Lookup File',
    },
    {
        id: 'data_models',
        label: 'Data models',
        endpoint: 'datamodel/model',
        namespace: { owner: '-', app: '-' },
        objectType: 'Data Model',
    },
    {
        id: 'indexes',
        label: 'Indexes',
        endpoint: 'data/indexes',
        namespace: { owner: '-', app: '-' },
        objectType: 'Index',
    },
    {
        id: 'sourcetypes',
        label: 'Sourcetypes',
        endpoint: 'saved/sourcetypes',
        namespace: { owner: '-', app: '-' },
        objectType: 'Sourcetype',
    },
];

const usageSourceDefinitions: UsageSourceDefinition[] = [
    {
        sourceId: SEARCH_AUDIT_SOURCE_ID,
        label: 'Splunk search audit',
        activityKind: 'saved_search_execution',
        search: (windowDays) => `search index=_audit action=search savedsearch_name=* earliest=-${windowDays}d latest=now
| eval activity_name=savedsearch_name, activity_app=coalesce(app, search_app, "unknown"), activity_user=coalesce(user, "")
| eval normalized_info=lower(coalesce(info, status, "unknown"))
| where isnotnull(activity_name) AND len(activity_name)>0
| eval activity_sid=coalesce(search_id, sid, md5(_raw))
| stats max(_time) as execution_time values(normalized_info) as execution_info by activity_app activity_name activity_user activity_sid
| eval successful=if(mvfind(execution_info, "^(completed|success)$")>=0, 1, 0), failed=if(mvfind(execution_info, "^failed$")>=0, 1, 0), skipped=if(mvfind(execution_info, "^skipped$")>=0, 1, 0)
| stats count as observation_count sum(successful) as successful_count sum(failed) as failed_count sum(skipped) as skipped_count max(execution_time) as last_observed by activity_app activity_name activity_user
| sort 0 - last_observed
| head 10000
| eval record_kind="activity"
| append [ | metadata type=sources index=_audit | stats sum(totalCount) as source_event_count min(firstTime) as coverage_start max(recentTime) as coverage_end | eval record_kind="coverage" ]
| fields record_kind activity_app activity_name activity_user observation_count successful_count failed_count skipped_count last_observed source_event_count coverage_start coverage_end`,
    },
    {
        sourceId: DASHBOARD_ACCESS_SOURCE_ID,
        label: 'Splunk Web access log',
        activityKind: 'dashboard_view',
        search: (windowDays) => `search index=_internal sourcetype=splunk_web_access earliest=-${windowDays}d latest=now
| eval request_path=coalesce(uri_path, uri, path)
| rex field=request_path "(?i)(?:/[a-z]{2}-[A-Z]{2})?/app/(?<activity_app>[^/?]+)/(?<activity_name>[^/?#]+)"
| eval activity_name=urldecode(activity_name), activity_user=coalesce(user, "")
| where isnotnull(activity_app) AND isnotnull(activity_name)
| stats count as observation_count max(_time) as last_observed by activity_app activity_name activity_user
| eval successful_count=observation_count, failed_count=0, skipped_count=0
| sort 0 - last_observed
| head 10000
| eval record_kind="activity"
| append [ | metadata type=sourcetypes index=_internal | search sourcetype=splunk_web_access | stats sum(totalCount) as source_event_count min(firstTime) as coverage_start max(recentTime) as coverage_end | eval record_kind="coverage" ]
| fields record_kind activity_app activity_name activity_user observation_count successful_count failed_count skipped_count last_observed source_event_count coverage_start coverage_end`,
    },
];

function asRecord(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonRecord)
        : {};
}

function stringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function booleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === '1' || value === 1 || value === 'true') {
        return true;
    }
    if (value === '0' || value === 0 || value === 'false') {
        return false;
    }
    return null;
}

function numberValue(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function nullableScore(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const score = numberValue(value);
    return score >= 0 && score <= 100 ? score : null;
}

function stringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }
    return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function normalizeTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1970) {
        return null;
    }
    return date.toISOString();
}

function normalizeSearchTimestamp(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return normalizeTimestamp(new Date(value * 1000).toISOString());
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return normalizeTimestamp(new Date(numeric * 1000).toISOString());
        }
    }
    return normalizeTimestamp(value);
}

function usageCoverage(value: unknown): UsageCoverage {
    return value === 'complete' ||
        value === 'partial' ||
        value === 'unavailable'
        ? value
        : 'unavailable';
}

function usageWindowDays(value: unknown): UsageWindowDays {
    return value === 30 || value === 90 || value === 180
        ? value
        : 90;
}

function objectTypeKey(objectType: string): string {
    return objectType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function canonicalObjectId(
    objectType: string,
    app: string,
    name: string,
    userNamespace: string | null = null
): string {
    const base = `${objectTypeKey(objectType)}::${app.trim()}`;
    return userNamespace
        ? `${base}::user:${userNamespace.trim()}::${name.trim()}`
        : `${base}::${name.trim()}`;
}

export function stableRecordKey(value: string, prefix = 'obj'): string {
    const modulus = 4294967291;
    let first = 5381;
    let second = 52711;

    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        first = (first * 33 + code) % modulus;
        second = (second * 65599 + code) % modulus;
    }

    const firstHex = first.toString(16).padStart(8, '0');
    const secondHex = second.toString(16).padStart(8, '0');
    return `${prefix}_${firstHex}${secondHex}`;
}

function entryAcl(entry: SplunkRestEntry): RestAcl {
    const content = asRecord(entry.content);
    return entry.acl ?? (asRecord(content['eai:acl']) as RestAcl);
}

function isProtectedObject(
    collectorId: string,
    app: string,
    name: string,
    content: JsonRecord
): boolean {
    const normalizedApp = app.toLowerCase();
    const normalizedName = name.toLowerCase();
    return (
        collectorId === 'apps' &&
        (booleanValue(content.core) === true || normalizedApp === 'system')
    ) ||
        (collectorId === 'indexes' &&
            (booleanValue(content.isInternal) === true ||
                normalizedName.startsWith('_'))) ||
        normalizedApp === APP_ID ||
        normalizedApp === 'system' ||
        normalizedApp.startsWith('splunk_') ||
        normalizedApp.startsWith('splunk-');
}

function enabledFromContent(content: JsonRecord): boolean | null {
    const disabled = booleanValue(content.disabled);
    return disabled === null ? null : !disabled;
}

function objectTypeForEntry(
    collector: ObjectCollectorDefinition,
    content: JsonRecord
): string {
    if (collector.id !== 'saved_searches') {
        return collector.objectType;
    }
    const scheduled = booleanValue(content.is_scheduled) === true;
    const actions = stringValue(content.actions).trim();
    if (scheduled && actions.length > 0) {
        return 'Alert';
    }
    return scheduled ? 'Report' : 'Saved Search';
}

function scheduledFromContent(
    collectorId: string,
    content: JsonRecord
): boolean | null {
    return collectorId === 'saved_searches'
        ? booleanValue(content.is_scheduled)
        : null;
}

function serializeAnalysisValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return '';
    }
    return JSON.stringify(value) ?? '';
}

export function normalizeObjectEntry(
    entry: SplunkRestEntry,
    collector: ObjectCollectorDefinition,
    scanId: string,
    collectedAt: string
): KvObjectRecord {
    const content = asRecord(entry.content);
    const acl = entryAcl(entry);
    const app =
        collector.id === 'apps'
            ? entry.name
            : stringValue(acl.app, stringValue(content['eai:appName'], 'unknown'));
    const ownerValue = stringValue(
        acl.owner,
        stringValue(content['eai:userName'], '')
    );
    const owner =
        ownerValue.length === 0 || ownerValue === 'nobody' || ownerValue === 'system'
            ? null
            : ownerValue;
    const sharing = stringValue(acl.sharing) || null;
    const displayName =
        collector.id === 'apps'
            ? stringValue(content.label, entry.name)
            : stringValue(content.label, entry.name);
    const objectType = objectTypeForEntry(collector, content);
    const objectId = canonicalObjectId(
        objectType,
        app,
        entry.name,
        sharing === 'user' ? ownerValue || 'unknown' : null
    );
    const protectedObject = isProtectedObject(
        collector.id,
        app,
        entry.name,
        content
    );
    const enabled = enabledFromContent(content);
    const scheduled = scheduledFromContent(collector.id, content);
    const evidence = [
        `Collected from the ${collector.label} REST endpoint`,
        enabled === false
            ? 'The source object is disabled'
            : 'No usage conclusion was inferred from configuration metadata',
    ];

    return {
        _key: stableRecordKey(objectId),
        object_id: objectId,
        name: entry.name,
        display_name: displayName,
        object_type: objectType,
        app,
        owner,
        sharing,
        enabled,
        scheduled,
        created: null,
        updated: normalizeTimestamp(entry.updated),
        last_used: null,
        inbound_references: 0,
        outbound_references: 0,
        health_status: protectedObject ? 'protected' : 'unknown',
        abandonment_confidence: null,
        removal_impact: null,
        protected: protectedObject,
        evidence,
        suggested_action: protectedObject
            ? 'Protected from cleanup review'
            : 'Collect usage and dependency evidence before review',
        source: {
            collector: collector.id,
            endpoint: collector.endpoint,
            source_name: entry.name,
            collected_at: collectedAt,
        },
        scan_id: scanId,
    };
}

function analysisSourceForEntry(
    entry: SplunkRestEntry,
    collector: ObjectCollectorDefinition,
    record: KvObjectRecord
): RawAnalysisSource | null {
    const content = asRecord(entry.content);
    let text = '';
    let kind: RawAnalysisSource['kind'] = 'spl';
    let sourceLocation = 'configuration';

    if (collector.id === 'saved_searches') {
        text = stringValue(content.search);
        sourceLocation = 'search';
    } else if (collector.id === 'macros') {
        text = stringValue(content.definition);
        sourceLocation = 'definition';
    } else if (collector.id === 'dashboards') {
        text = stringValue(content['eai:data']);
        kind = 'dashboard';
        sourceLocation = 'eai:data';
    } else if (collector.id === 'data_models') {
        text = serializeAnalysisValue(content['dataset.commands']);
        sourceLocation = 'dataset.commands';
    }

    return text.trim()
        ? {
              objectId: record.object_id,
              kind,
              text,
              sourceLocation,
          }
        : null;
}

function normalizeOwnerEntry(
    entry: SplunkRestEntry,
    scanId: string,
    collectedAt: string
): KvOwnerRecord {
    const content = asRecord(entry.content);
    const lockedOut = booleanValue(content['locked-out']) === true;
    const roles = stringArray(content.roles);

    return {
        _key: stableRecordKey(entry.name, 'owner'),
        owner: entry.name,
        status: lockedOut ? 'disabled' : 'active',
        roles,
        object_count: 0,
        active_count: 0,
        review_count: 0,
        unowned_count: 0,
        source: {
            collector: 'owners',
            endpoint: 'authentication/users',
            collected_at: collectedAt,
        },
        scan_id: scanId,
    };
}

function collectionUrl(collection: string, suffix = ''): string {
    return createRESTURL(
        `storage/collections/data/${collection}${suffix}`,
        { owner: 'nobody', app: APP_ID }
    );
}

function withQuery(url: string, query: Record<string, string | number>): string {
    const search = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => search.set(key, String(value)));
    return `${url}?${search.toString()}`;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
    try {
        const data = (await response.json()) as {
            messages?: Array<{ text?: string }>;
        };
        const message = data.messages?.find(({ text }) => Boolean(text))?.text;
        return new RestRequestError(response.status, message ?? fallback);
    } catch {
        return new RestRequestError(response.status, fallback);
    }
}

async function requestJson<T>(
    url: string,
    init: RequestInit = {},
    expectedStatuses: number[] = [200]
): Promise<T> {
    const response = await fetch(
        url,
        createFetchInit({
            ...init,
            headers: {
                Accept: 'application/json',
                ...(init.headers ?? {}),
            },
        })
    );

    if (!expectedStatuses.includes(response.status)) {
        throw await responseError(
            response,
            `Splunk request failed with status ${response.status}`
        );
    }
    if (response.status === 204) {
        return null as T;
    }
    return (await response.json()) as T;
}

async function runOneshotSearch(search: string): Promise<SplunkSearchResponse> {
    const body = new URLSearchParams();
    body.set('search', search);
    body.set('exec_mode', 'oneshot');
    body.set('output_mode', 'json');
    body.set('count', '0');
    body.set('max_time', '120');
    body.set('timeout', '130');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 140000);
    try {
        return await requestJson<SplunkSearchResponse>(
            createRESTURL('search/jobs', {
                owner: username || '-',
                app: APP_ID,
            }),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.toString(),
                signal: controller.signal,
            },
            [200, 201]
        );
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(
                'The telemetry search exceeded the 140-second interactive safety limit.'
            );
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function collectUsageSource(
    definition: UsageSourceDefinition,
    windowDays: UsageWindowDays,
    windowStart: string,
    windowEnd: string
): Promise<CollectedUsageSource> {
    const response = await runOneshotSearch(definition.search(windowDays));
    const rows = response.results ?? [];
    const coverageRow = rows.find(
        (row) => stringValue(row.record_kind) === 'coverage'
    );
    const activityRows = rows.filter(
        (row) => stringValue(row.record_kind) === 'activity'
    );
    const sourceEventCount = numberValue(coverageRow?.source_event_count);
    const coverageStart = normalizeSearchTimestamp(
        coverageRow?.coverage_start
    );
    const coverageEnd = normalizeSearchTimestamp(coverageRow?.coverage_end);
    const sourceWindowCoverage = sourceCoverageForWindow(
        sourceEventCount,
        coverageStart,
        coverageEnd,
        windowStart,
        windowEnd
    );
    const activities: UsageActivityAggregate[] = activityRows
        .map((row) => ({
            app: stringValue(row.activity_app),
            name: stringValue(row.activity_name),
            user: stringValue(row.activity_user) || null,
            observationCount: numberValue(row.observation_count),
            successfulCount: numberValue(row.successful_count),
            failedCount: numberValue(row.failed_count),
            skippedCount: numberValue(row.skipped_count),
            lastObserved: normalizeSearchTimestamp(row.last_observed),
        }))
        .filter(
            (activity) =>
                activity.app.length > 0 &&
                activity.name.length > 0 &&
                activity.observationCount > 0
        );
    const truncated = activities.length >= 10000;
    const responseWarnings = (response.messages ?? [])
        .filter(
            (message) =>
                message.type === 'WARN' || message.type === 'ERROR'
        )
        .map((message) => message.text ?? 'Splunk returned a search warning.');
    const coverage: UsageCoverage =
        sourceWindowCoverage === 'complete' &&
        (truncated || responseWarnings.length > 0)
            ? 'partial'
            : sourceWindowCoverage;
    const warnings = [
        coverage === 'unavailable'
            ? 'No source events were visible, so absence of object activity cannot be interpreted.'
            : null,
        coverage === 'partial'
            ? `Visible source data spans ${
                  coverageStart ?? 'an unknown start'
              } through ${
                  coverageEnd ?? 'an unknown end'
              }, which does not establish the complete requested window.`
            : null,
        truncated
            ? 'Activity aggregation reached the 10,000-row safety cap.'
            : null,
        ...responseWarnings,
    ].filter((value): value is string => Boolean(value));

    return {
        activities,
        summary: {
            sourceId: definition.sourceId,
            label: definition.label,
            activityKind: definition.activityKind,
            coverage,
            coverageStart,
            coverageEnd,
            sourceEventCount,
            activityRecordCount: activities.length,
            matchedObjectCount: 0,
            truncated,
            warning: warnings.length > 0 ? warnings.join(' ') : null,
        },
    };
}

async function collectEntries(
    collector: ObjectCollectorDefinition,
    mode: ScanMode
): Promise<CollectedEntries> {
    const maximum =
        mode === 'bounded'
            ? BOUNDED_SCAN_LIMIT
            : FULL_SCAN_MAX_PER_COLLECTOR;
    const pageSize =
        mode === 'bounded' ? BOUNDED_SCAN_LIMIT : FULL_SCAN_PAGE_SIZE;
    const entries: SplunkRestEntry[] = [];
    let total = 0;
    let offset = 0;

    /* eslint-disable no-await-in-loop -- collector pages are intentionally serial to cap search-head request load. */
    while (entries.length < maximum) {
        const count = Math.min(pageSize, maximum - entries.length);
        const url = withQuery(
            createRESTURL(collector.endpoint, collector.namespace),
            {
                count,
                offset,
                output_mode: 'json',
            }
        );
        const response = await requestJson<SplunkRestResponse>(url);
        const page = response.entry ?? [];
        total = numberValue(response.paging?.total ?? page.length);
        entries.push(...page);
        offset += page.length;
        if (page.length < count || entries.length >= total) {
            break;
        }
    }
    /* eslint-enable no-await-in-loop */

    return {
        entries,
        total,
        complete: entries.length >= total,
    };
}

async function collectOwners(mode: ScanMode): Promise<CollectedEntries> {
    return collectEntries(
        {
            id: 'owners',
            label: 'Owners',
            endpoint: 'authentication/users',
            objectType: 'Owner',
        },
        mode
    );
}

async function batchSave(collection: string, records: JsonRecord[]): Promise<void> {
    const batchCount = Math.ceil(records.length / BATCH_SIZE);
    const batches = Array.from({ length: batchCount }, (_, index) =>
        records.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE)
    );
    /* eslint-disable no-await-in-loop -- batch groups cap concurrent KV writes to protect the search head. */
    for (
        let offset = 0;
        offset < batches.length;
        offset += BATCH_CONCURRENCY
    ) {
        const group = batches.slice(offset, offset + BATCH_CONCURRENCY);
        await Promise.all(
            group.map((batch) =>
                requestJson<unknown>(
                    collectionUrl(collection, '/batch_save'),
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(batch),
                    },
                    [200, 201]
                )
            )
        );
    }
    /* eslint-enable no-await-in-loop */
}

async function createRecord(
    collection: string,
    record: JsonRecord
): Promise<void> {
    await requestJson<unknown>(
        collectionUrl(collection),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        },
        [200, 201]
    );
}

async function updateRecord(
    collection: string,
    key: string,
    record: JsonRecord
): Promise<void> {
    await requestJson<unknown>(
        collectionUrl(collection, `/${encodeURIComponent(key)}`),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        },
        [200, 201]
    );
}

async function getRecord<T>(collection: string, key: string): Promise<T | null> {
    try {
        return await requestJson<T>(
            collectionUrl(collection, `/${encodeURIComponent(key)}`)
        );
    } catch (error) {
        if (error instanceof RestRequestError && error.status === 404) {
            return null;
        }
        throw error;
    }
}

async function deleteRecord(collection: string, key: string): Promise<void> {
    await requestJson<unknown>(
        collectionUrl(collection, `/${encodeURIComponent(key)}`),
        { method: 'DELETE' },
        [200, 204]
    );
}

function createScanId(): string {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const random = Math.random().toString(36).slice(2, 8);
    return `scan-${timestamp}-${random}`;
}

async function acquireScanLock(scanId: string): Promise<void> {
    const now = new Date();
    const lock: ScanLockRecord = {
        _key: LOCK_KEY,
        scan_id: scanId,
        acquired_at: now.toISOString(),
        expires_at: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
        owner: username || 'unknown',
    };

    try {
        await createRecord('ch_settings', lock);
        return;
    } catch (error) {
        if (!(error instanceof RestRequestError) || error.status !== 409) {
            throw error;
        }
    }

    const existing = await getRecord<ScanLockRecord>('ch_settings', LOCK_KEY);
    if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
        throw new Error(
            `An inventory scan is already running (${existing.scan_id}).`
        );
    }

    if (existing) {
        const interrupted = await getRecord<KvScanRecord>(
            'ch_scan_runs',
            existing.scan_id
        );
        if (interrupted?.status === 'running') {
            await updateRecord('ch_scan_runs', existing.scan_id, {
                status: 'failed',
                completed_at: new Date().toISOString(),
                errors: [
                    ...stringArray(interrupted.errors),
                    'The scan lock expired before the scan completed.',
                ],
            });
        }
        await deleteRecord('ch_settings', LOCK_KEY);
    }

    await createRecord('ch_settings', lock);
}

async function releaseScanLock(scanId: string): Promise<void> {
    const existing = await getRecord<ScanLockRecord>('ch_settings', LOCK_KEY);
    if (existing?.scan_id === scanId) {
        await deleteRecord('ch_settings', LOCK_KEY);
    }
}

function scanRecordToSummary(record: KvScanRecord): ScanSummary {
    const warnings = stringArray(record.warnings);
    const errors = stringArray(record.errors);
    const collectorCountsRecord = asRecord(record.collector_counts);
    const collectorTotalsRecord = asRecord(record.collector_totals);
    const collectorCounts = Object.entries(collectorCountsRecord).reduce<
        Record<string, number>
    >(
        (counts, [key, value]) => ({
            ...counts,
            [key]: numberValue(value),
        }),
        {}
    );
    const collectorTotals = Object.entries(collectorTotalsRecord).reduce<
        Record<string, number>
    >(
        (totals, [key, value]) => ({
            ...totals,
            [key]: numberValue(value),
        }),
        {}
    );

    return {
        scanId: record.scan_id,
        scanType: record.scan_type,
        status: record.status,
        startedAt: record.started_at,
        completedAt: record.completed_at,
        objectCount: numberValue(record.object_count),
        edgeCount: numberValue(record.edge_count),
        findingCount: numberValue(record.finding_count),
        candidateCount: null,
        warningCount: warnings.length,
        warnings,
        errors,
        collectorCounts,
        collectorTotals,
        analysisStatus:
            record.analysis_status === 'complete' ||
            record.analysis_status === 'partial' ||
            record.analysis_status === 'failed'
                ? record.analysis_status
                : 'pending',
        dataSource: 'live',
    };
}

function isHealthStatus(value: string): value is HealthStatus {
    return [
        'active',
        'dormant',
        'orphaned',
        'broken',
        'unowned',
        'protected',
        'unknown',
    ].includes(value);
}

function isConfidenceLevel(value: string): value is ConfidenceLevel {
    return ['high', 'medium', 'low', 'unknown'].includes(value);
}

function isFindingType(value: string): value is FindingType {
    return [
        'cleanup_candidate',
        'broken_reference',
        'unowned',
        'protected',
        'needs_review',
        'repair_required',
        'insufficient_evidence',
    ].includes(value);
}

function objectRecordToContentObject(record: KvObjectRecord): ContentObject {
    const healthStatus = stringValue(record.health_status, 'unknown');
    return {
        objectId: stringValue(record.object_id),
        canonicalName: stringValue(record.name),
        name: stringValue(record.display_name, stringValue(record.name)),
        objectType: stringValue(record.object_type, 'Unknown'),
        app: stringValue(record.app, 'unknown'),
        owner:
            typeof record.owner === 'string' && record.owner.length > 0
                ? record.owner
                : null,
        sharing: stringValue(record.sharing) || null,
        enabled: booleanValue(record.enabled),
        scheduled: booleanValue(record.scheduled),
        updated: normalizeTimestamp(record.updated),
        lastUsed: normalizeTimestamp(record.last_used),
        usageEvidence: null,
        healthStatus: isHealthStatus(healthStatus) ? healthStatus : 'unknown',
        abandonmentConfidence: nullableScore(record.abandonment_confidence),
        removalImpact: nullableScore(record.removal_impact),
        inboundReferences: numberValue(record.inbound_references),
        outboundReferences: numberValue(record.outbound_references),
        protected: Boolean(record.protected),
        evidence: stringArray(record.evidence),
        suggestedAction: stringValue(
            record.suggested_action,
            'Collect usage and dependency evidence before review'
        ),
    };
}

function edgeRecordToDependencyEdge(record: KvEdgeRecord): DependencyEdge {
    const confidence = stringValue(record.confidence, 'unknown');
    return {
        edgeId: stringValue(record.edge_id),
        sourceId: stringValue(record.source_id),
        targetId: stringValue(record.target_id),
        relation: stringValue(record.relation, 'unknown'),
        confidence: isConfidenceLevel(confidence) ? confidence : 'unknown',
        evidence: stringValue(record.evidence, 'No evidence text was recorded'),
        sourceLocation: stringValue(record.source_location) || null,
        resolved: Boolean(record.resolved),
    };
}

function findingRecordToContentFinding(record: KvFindingRecord): ContentFinding {
    const findingType = stringValue(record.finding_type, 'insufficient_evidence');
    return {
        findingId: stringValue(record.finding_id),
        objectId: stringValue(record.object_id),
        findingType: isFindingType(findingType)
            ? findingType
            : 'insufficient_evidence',
        abandonmentConfidence: nullableScore(record.abandonment_confidence),
        removalImpact: nullableScore(record.removal_impact),
        reasons: stringArray(record.reasons),
        suggestedAction: stringValue(
            record.suggested_action,
            'Review the recorded evidence'
        ),
        createdAt: normalizeTimestamp(record.created_at),
    };
}

function isUsageActivityKind(value: string): value is UsageActivityKind {
    return (
        value === 'saved_search_execution' || value === 'dashboard_view'
    );
}

function usageEvidenceToRecord(
    objectId: string,
    usage: UsageEvidence
): KvUsageEvidenceRecord {
    return {
        _key: stableRecordKey(`${usage.usageRunId}::${objectId}`, 'usage'),
        scan_id: usage.usageRunId,
        usage_run_id: usage.usageRunId,
        inventory_scan_id: usage.inventoryScanId,
        object_id: objectId,
        source_id: usage.sourceId,
        source_label: usage.sourceLabel,
        activity_kind: usage.activityKind,
        window_days: usage.windowDays,
        window_start: usage.windowStart,
        window_end: usage.windowEnd,
        coverage: usage.coverage,
        coverage_start: usage.coverageStart,
        coverage_end: usage.coverageEnd,
        source_event_count: usage.sourceEventCount,
        observation_count: usage.observationCount,
        successful_count: usage.successfulCount,
        failed_count: usage.failedCount,
        skipped_count: usage.skippedCount,
        last_observed: usage.lastObserved,
        evidence: usage.evidence,
    };
}

function usageRecordToEvidence(record: KvUsageEvidenceRecord): UsageEvidence {
    const activityKind = stringValue(record.activity_kind);
    return {
        usageRunId: stringValue(record.usage_run_id),
        inventoryScanId: stringValue(record.inventory_scan_id),
        sourceId: stringValue(record.source_id),
        sourceLabel: stringValue(record.source_label, 'Splunk telemetry'),
        activityKind: isUsageActivityKind(activityKind)
            ? activityKind
            : 'saved_search_execution',
        windowDays: usageWindowDays(numberValue(record.window_days)),
        windowStart:
            normalizeTimestamp(record.window_start) ??
            new Date(0).toISOString(),
        windowEnd:
            normalizeTimestamp(record.window_end) ?? new Date(0).toISOString(),
        coverage: usageCoverage(record.coverage),
        coverageStart: normalizeTimestamp(record.coverage_start),
        coverageEnd: normalizeTimestamp(record.coverage_end),
        sourceEventCount: numberValue(record.source_event_count),
        observationCount: numberValue(record.observation_count),
        successfulCount: numberValue(record.successful_count),
        failedCount: numberValue(record.failed_count),
        skippedCount: numberValue(record.skipped_count),
        lastObserved: normalizeTimestamp(record.last_observed),
        evidence: stringArray(record.evidence),
    };
}

function usageSourceSummaryFromRecord(value: unknown): UsageSourceSummary {
    const record = asRecord(value);
    const activityKind = stringValue(record.activityKind);
    return {
        sourceId: stringValue(record.sourceId),
        label: stringValue(record.label, 'Splunk telemetry'),
        activityKind: isUsageActivityKind(activityKind)
            ? activityKind
            : 'saved_search_execution',
        coverage: usageCoverage(record.coverage),
        coverageStart: normalizeTimestamp(record.coverageStart),
        coverageEnd: normalizeTimestamp(record.coverageEnd),
        sourceEventCount: numberValue(record.sourceEventCount),
        activityRecordCount: numberValue(record.activityRecordCount),
        matchedObjectCount: numberValue(record.matchedObjectCount),
        truncated: booleanValue(record.truncated) === true,
        warning: stringValue(record.warning) || null,
    };
}

function usageSummaryFromScanRecord(
    record: KvScanRecord,
    currentInventoryScanId: string
): UsageSummary {
    const warnings = stringArray(record.warnings);
    return {
        runId: record.scan_id,
        inventoryScanId: stringValue(record.inventory_scan_id),
        status: record.status,
        startedAt: record.started_at,
        completedAt: record.completed_at,
        windowDays: usageWindowDays(numberValue(record.usage_window_days)),
        windowStart:
            normalizeTimestamp(record.usage_window_start) ??
            record.started_at,
        windowEnd:
            normalizeTimestamp(record.usage_window_end) ??
            record.completed_at ??
            record.started_at,
        coverage: usageCoverage(record.usage_coverage),
        eligibleObjectCount: numberValue(record.eligible_object_count),
        fullyCoveredObjectCount: numberValue(
            record.fully_covered_object_count
        ),
        observedObjectCount: numberValue(record.observed_object_count),
        warningCount: warnings.length,
        warnings,
        sources: Array.isArray(record.usage_sources)
            ? record.usage_sources.map(usageSourceSummaryFromRecord)
            : [],
        matchesCurrentInventory:
            record.inventory_scan_id === currentInventoryScanId,
    };
}

function analyzedObjectToRecord(
    original: KvObjectRecord,
    analyzed: ContentObject
): KvObjectRecord {
    return {
        ...original,
        inbound_references: analyzed.inboundReferences,
        outbound_references: analyzed.outboundReferences,
        health_status: analyzed.healthStatus,
        abandonment_confidence: analyzed.abandonmentConfidence,
        removal_impact: analyzed.removalImpact,
        evidence: analyzed.evidence,
        suggested_action: analyzed.suggestedAction,
    };
}

function dependencyEdgeToRecord(
    edge: DependencyEdge,
    scanId: string
): KvEdgeRecord {
    return {
        _key: stableRecordKey(`${scanId}::${edge.edgeId}`, 'edge'),
        edge_id: edge.edgeId,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        relation: edge.relation,
        confidence: edge.confidence,
        evidence: edge.evidence,
        source_location: edge.sourceLocation,
        resolved: edge.resolved,
        scan_id: scanId,
    };
}

function contentFindingToRecord(
    finding: ContentFinding,
    scanId: string
): KvFindingRecord {
    return {
        _key: stableRecordKey(`${scanId}::${finding.findingId}`, 'finding'),
        finding_id: finding.findingId,
        object_id: finding.objectId,
        finding_type: finding.findingType,
        abandonment_confidence: finding.abandonmentConfidence,
        removal_impact: finding.removalImpact,
        reasons: finding.reasons,
        suggested_action: finding.suggestedAction,
        created_at: finding.createdAt,
        scan_id: scanId,
    };
}

async function getCollectionRecords<T>(
    collection: string,
    scanId: string
): Promise<T[]> {
    const records: T[] = [];
    let skip = 0;

    /* eslint-disable no-await-in-loop -- KV snapshots are paged serially to avoid unbounded browser memory and request bursts. */
    while (true) {
        const url = withQuery(collectionUrl(collection), {
            query: JSON.stringify({ scan_id: scanId }),
            limit: SNAPSHOT_PAGE_SIZE,
            skip,
        });
        const page = await requestJson<T[]>(url);
        records.push(...page);
        if (page.length < SNAPSHOT_PAGE_SIZE) {
            break;
        }
        skip += page.length;
    }
    /* eslint-enable no-await-in-loop */

    return records;
}

async function getLatestInventoryScanRecord(): Promise<KvScanRecord | null> {
    const url = withQuery(collectionUrl('ch_scan_runs'), {
        query: JSON.stringify({
            scan_type: { $in: ['bounded', 'full'] },
            status: { $in: ['succeeded', 'partial'] },
        }),
        sort: 'started_at:-1',
        limit: 1,
    });
    const records = await requestJson<KvScanRecord[]>(url);
    return records[0] ?? null;
}

async function getLatestUsageScanRecord(): Promise<KvScanRecord | null> {
    const url = withQuery(collectionUrl('ch_scan_runs'), {
        query: JSON.stringify({
            scan_type: 'usage',
            status: { $in: ['succeeded', 'partial', 'failed'] },
        }),
        sort: 'started_at:-1',
        limit: 1,
    });
    const records = await requestJson<KvScanRecord[]>(url);
    return records[0] ?? null;
}

function summarizeOwners(
    ownerRecords: KvOwnerRecord[],
    objects: ContentObject[]
): OwnerSummary[] {
    const ownerStatus = new Map<string, OwnerSummary['status']>(
        ownerRecords.map(
            (record): [string, OwnerSummary['status']] => [
                stringValue(record.owner),
                record.status === 'disabled' ? 'disabled' : 'active',
            ]
        )
    );
    const summaries = new Map<string, OwnerSummary>();
    const statusForObject = (
        contentObject: ContentObject,
        sharedScope: boolean
    ): OwnerSummary['status'] => {
        if (contentObject.owner) {
            return ownerStatus.get(contentObject.owner) ?? 'missing';
        }
        return sharedScope ? 'shared' : 'missing';
    };

    ownerStatus.forEach((status, owner) => {
        if (owner) {
            summaries.set(owner, {
                owner,
                status,
                objectCount: 0,
                activeCount: 0,
                reviewCount: 0,
                unownedCount: 0,
            });
        }
    });

    objects.forEach((contentObject) => {
        const sharedScope =
            !contentObject.owner &&
            (contentObject.sharing === 'app' ||
                contentObject.sharing === 'global');
        const userScopedGap =
            !contentObject.owner && contentObject.sharing === 'user';
        let owner = contentObject.owner ?? 'Ownership metadata unavailable';
        let status: OwnerSummary['status'] = 'unknown';
        if (contentObject.owner) {
            status = statusForObject(contentObject, false);
        } else if (sharedScope) {
            owner = 'App/global scope';
            status = 'shared';
        } else if (userScopedGap) {
            owner = 'Unowned';
            status = 'missing';
        }
        const existing: OwnerSummary = summaries.get(owner) ?? {
            owner,
            status,
            objectCount: 0,
            activeCount: 0,
            reviewCount: 0,
            unownedCount: 0,
        };
        existing.objectCount += 1;
        if (contentObject.healthStatus === 'active') {
            existing.activeCount += 1;
        }
        if (
            ['dormant', 'orphaned', 'broken', 'unowned'].includes(
                contentObject.healthStatus
            )
        ) {
            existing.reviewCount += 1;
        }
        if (userScopedGap) {
            existing.unownedCount += 1;
        }
        summaries.set(owner, existing);
    });

    return Array.from(summaries.values()).sort(
        (left, right) =>
            right.objectCount - left.objectCount ||
            left.owner.localeCompare(right.owner)
    );
}

async function loadSnapshot(
    record: KvScanRecord,
    usageRecordOverride?: KvScanRecord
): Promise<InventorySnapshot> {
    const usageRecord =
        usageRecordOverride ?? (await getLatestUsageScanRecord());
    const [objectRecords, edgeRecords, findingRecords, ownerRecords, usageRecords] =
        await Promise.all([
            getCollectionRecords<KvObjectRecord>('ch_objects', record.scan_id),
            getCollectionRecords<KvEdgeRecord>('ch_edges', record.scan_id),
            getCollectionRecords<KvFindingRecord>('ch_findings', record.scan_id),
            getCollectionRecords<KvOwnerRecord>('ch_owners', record.scan_id),
            usageRecord
                ? getCollectionRecords<KvUsageEvidenceRecord>(
                      'ch_usage_evidence',
                      usageRecord.scan_id
                  )
                : Promise.resolve([]),
        ]);
    const baseObjects = objectRecords.map(objectRecordToContentObject);
    const baseFindings = findingRecords.map(findingRecordToContentFinding);
    const applied = applyUsageEvidence(
        baseObjects,
        baseFindings,
        usageRecords.map((storedUsage) => ({
            objectId: stringValue(storedUsage.object_id),
            usage: usageRecordToEvidence(storedUsage),
        })),
        record.scan_id
    );
    const scan = scanRecordToSummary(record);
    scan.candidateCount = applied.findings.filter((finding) =>
        [
            'cleanup_candidate',
            'broken_reference',
            'unowned',
            'needs_review',
            'repair_required',
        ].includes(finding.findingType)
    ).length;

    return {
        scan,
        usage: usageRecord
            ? usageSummaryFromScanRecord(usageRecord, record.scan_id)
            : null,
        objects: applied.objects,
        edges: edgeRecords.map(edgeRecordToDependencyEdge),
        findings: applied.findings,
        owners: summarizeOwners(ownerRecords, applied.objects),
    };
}

async function getLatestSnapshot(): Promise<InventorySnapshot | null> {
    const record = await getLatestInventoryScanRecord();
    return record ? loadSnapshot(record) : null;
}

async function runInventoryScan(
    mode: ScanMode,
    onProgress?: (progress: ScanProgress) => void
): Promise<InventorySnapshot> {
    if (!splunkdPath) {
        throw new Error('A Splunk Web session is required to run inventory.');
    }

    const scanId = createScanId();
    const startedAt = new Date().toISOString();
    const totalCollectors = objectCollectors.length + 2;
    const collectorCounts: Record<string, number> = {};
    const collectorTotals: Record<string, number> = {};
    const completeness: AnalysisCompleteness = {
        macros: false,
        lookup_definitions: false,
        lookup_files: false,
        saved_searches: false,
        data_models: false,
        indexes: false,
        sourcetypes: false,
    };
    const warnings: string[] = [];
    const errors: string[] = [];
    const allObjectRecords: KvObjectRecord[] = [];
    const analysisSources: RawAnalysisSource[] = [];
    let completedCollectors = 0;
    let objectCount = 0;
    let edgeCount = 0;
    let findingCount = 0;
    let analysisStatus: ScanSummary['analysisStatus'] = 'pending';
    let scanRecordCreated = false;

    await acquireScanLock(scanId);

    const runningRecord: KvScanRecord = {
        _key: scanId,
        scan_id: scanId,
        scan_type: mode,
        status: 'running',
        started_at: startedAt,
        completed_at: null,
        object_count: 0,
        edge_count: 0,
        finding_count: 0,
        warnings: [],
        errors: [],
        collector_counts: {},
        collector_totals: {},
        collector_versions: {
            rest_inventory: '0.2.0',
            dependency_analysis: '0.1.0',
            classification: '0.1.0',
        },
        scan_limit_per_collector:
            mode === 'bounded'
                ? BOUNDED_SCAN_LIMIT
                : FULL_SCAN_MAX_PER_COLLECTOR,
        scan_mode: mode,
        initiated_by: username || 'unknown',
        analysis_status: 'pending',
    };

    try {
        await createRecord('ch_scan_runs', runningRecord);
        scanRecordCreated = true;

        /* eslint-disable no-restricted-syntax, no-await-in-loop -- REST collectors run serially to cap search-head load and persist independent checkpoints. */
        for (const collector of objectCollectors) {
            onProgress?.({
                completedCollectors,
                totalCollectors,
                stage: `Collecting ${collector.label.toLowerCase()}`,
            });

            try {
                const collected = await collectEntries(collector, mode);
                const collectedAt = new Date().toISOString();
                const records = collected.entries.map((entry) =>
                    normalizeObjectEntry(entry, collector, scanId, collectedAt)
                );
                await batchSave('ch_objects', records);
                allObjectRecords.push(...records);
                collected.entries.forEach((entry, index) => {
                    const source = analysisSourceForEntry(
                        entry,
                        collector,
                        records[index]
                    );
                    if (source) {
                        analysisSources.push(source);
                    }
                });
                collectorCounts[collector.id] = records.length;
                collectorTotals[collector.id] = collected.total;
                if (collector.id in completeness) {
                    completeness[
                        collector.id as keyof AnalysisCompleteness
                    ] = collected.complete;
                }
                if (!collected.complete) {
                    const scanLabel =
                        mode === 'bounded' ? 'bounded live scan' : 'full scan';
                    warnings.push(
                        `${collector.label}: ${scanLabel} cached ${records.length.toLocaleString()} of ${collected.total.toLocaleString()} visible records.`
                    );
                }
                objectCount += records.length;
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : 'Unknown collector error';
                warnings.push(`${collector.label}: ${message}`);
                collectorCounts[collector.id] = 0;
                collectorTotals[collector.id] = 0;
            }

            completedCollectors += 1;
            await updateRecord('ch_scan_runs', scanId, {
                object_count: objectCount,
                warnings,
                collector_counts: collectorCounts,
                collector_totals: collectorTotals,
                completed_collectors: completedCollectors,
                total_collectors: totalCollectors,
            });
        }
        /* eslint-enable no-restricted-syntax, no-await-in-loop */

        onProgress?.({
            completedCollectors,
            totalCollectors,
            stage: 'Collecting owners',
        });
        try {
            const collected = await collectOwners(mode);
            const collectedAt = new Date().toISOString();
            const ownerRecords = collected.entries.map((entry) =>
                normalizeOwnerEntry(entry, scanId, collectedAt)
            );
            await batchSave('ch_owners', ownerRecords);
            collectorCounts.owners = ownerRecords.length;
            collectorTotals.owners = collected.total;
            if (!collected.complete) {
                const scanLabel =
                    mode === 'bounded' ? 'bounded live scan' : 'full scan';
                warnings.push(
                    `Owners: ${scanLabel} cached ${ownerRecords.length.toLocaleString()} of ${collected.total.toLocaleString()} visible records.`
                );
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unknown collector error';
            warnings.push(`Owners: ${message}`);
            collectorCounts.owners = 0;
            collectorTotals.owners = 0;
        }
        completedCollectors += 1;

        onProgress?.({
            completedCollectors,
            totalCollectors,
            stage: 'Extracting dependencies and classifying evidence',
        });
        try {
            const assertionCompleteness: AnalysisCompleteness = {
                ...completeness,
                // The visible sourcetype catalog is useful inventory, but an
                // absent entry does not prove a configured/inactive
                // sourcetype does not exist.
                sourcetypes: false,
            };
            const analysis = analyzeInventory(
                allObjectRecords.map(objectRecordToContentObject),
                analysisSources,
                assertionCompleteness
            );
            const analyzedById = new Map(
                analysis.objects.map((contentObject) => [
                    contentObject.objectId,
                    contentObject,
                ])
            );
            const analyzedRecords = allObjectRecords.map((record) => {
                const analyzed = analyzedById.get(record.object_id);
                return analyzed
                    ? analyzedObjectToRecord(record, analyzed)
                    : record;
            });
            const edgeRecords = analysis.edges.map((edge) =>
                dependencyEdgeToRecord(edge, scanId)
            );
            const findingRecords = analysis.findings.map((findingValue) =>
                contentFindingToRecord(findingValue, scanId)
            );
            await Promise.all([
                batchSave('ch_objects', analyzedRecords),
                batchSave('ch_edges', edgeRecords),
                batchSave('ch_findings', findingRecords),
            ]);
            edgeCount = edgeRecords.length;
            findingCount = findingRecords.length;
            const completeAnalysis = Object.values(completeness).every(Boolean);
            analysisStatus = completeAnalysis ? 'complete' : 'partial';
            await updateRecord('ch_scan_runs', scanId, {
                edge_count: edgeCount,
                finding_count: findingCount,
                analysis_status: analysisStatus,
                parser_counts: analysis.parserCounts,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unknown analysis error';
            warnings.push(`Dependency analysis: ${message}`);
            analysisStatus = 'failed';
        }
        completedCollectors += 1;

        let status: ScanStatus = 'succeeded';
        if (objectCount === 0) {
            status = 'failed';
        } else if (warnings.length > 0) {
            status = 'partial';
        }
        if (objectCount === 0) {
            errors.push('No collector completed successfully.');
        }

        const completedAt = new Date().toISOString();
        const completedRecord: KvScanRecord = {
            ...runningRecord,
            status,
            completed_at: completedAt,
            object_count: objectCount,
            edge_count: edgeCount,
            finding_count: findingCount,
            warnings,
            errors,
            collector_counts: collectorCounts,
            collector_totals: collectorTotals,
            completed_collectors: completedCollectors,
            total_collectors: totalCollectors,
            duration_ms: Date.now() - new Date(startedAt).getTime(),
            analysis_status: analysisStatus,
        };
        await updateRecord('ch_scan_runs', scanId, completedRecord);
        onProgress?.({
            completedCollectors,
            totalCollectors,
            stage: 'Loading live inventory',
        });
        return loadSnapshot(completedRecord);
    } catch (error) {
        if (scanRecordCreated) {
            const message =
                error instanceof Error ? error.message : 'Unknown scan failure';
            await updateRecord('ch_scan_runs', scanId, {
                status: 'failed',
                completed_at: new Date().toISOString(),
                object_count: objectCount,
                warnings,
                errors: [...errors, message],
                collector_counts: collectorCounts,
                collector_totals: collectorTotals,
            }).catch(() => undefined);
        }
        throw error;
    } finally {
        await releaseScanLock(scanId).catch(() => undefined);
    }
}

function unavailableUsageSource(
    definition: UsageSourceDefinition,
    message: string
): CollectedUsageSource {
    return {
        activities: [],
        summary: {
            sourceId: definition.sourceId,
            label: definition.label,
            activityKind: definition.activityKind,
            coverage: 'unavailable',
            coverageStart: null,
            coverageEnd: null,
            sourceEventCount: 0,
            activityRecordCount: 0,
            matchedObjectCount: 0,
            truncated: false,
            warning: message,
        },
    };
}

function combinedUsageCoverage(
    sources: UsageSourceSummary[]
): UsageCoverage {
    const coverages = sources.map(({ coverage }) => coverage);
    if (coverages.every((coverage) => coverage === 'complete')) {
        return 'complete';
    }
    if (coverages.every((coverage) => coverage === 'unavailable')) {
        return 'unavailable';
    }
    return 'partial';
}

function usageScanStatus(coverage: UsageCoverage): ScanStatus {
    if (coverage === 'complete') {
        return 'succeeded';
    }
    return coverage === 'unavailable' ? 'failed' : 'partial';
}

function usageAnalysisStatus(
    coverage: UsageCoverage
): ScanSummary['analysisStatus'] {
    if (coverage === 'complete') {
        return 'complete';
    }
    return coverage === 'unavailable' ? 'failed' : 'partial';
}

async function runUsageScan(
    windowDays: UsageWindowDays,
    onProgress?: (progress: ScanProgress) => void
): Promise<InventorySnapshot> {
    if (!splunkdPath) {
        throw new Error('A Splunk Web session is required to collect usage evidence.');
    }
    const inventoryRecord = await getLatestInventoryScanRecord();
    if (!inventoryRecord) {
        throw new Error(
            'Run a bounded or complete live inventory scan before collecting usage evidence.'
        );
    }

    const inventorySnapshot = await loadSnapshot(inventoryRecord);
    const scanId = createScanId();
    const startedAt = new Date().toISOString();
    const windowEnd = startedAt;
    const windowStart = new Date(
        new Date(windowEnd).getTime() - windowDays * 86400000
    ).toISOString();
    const totalCollectors = usageSourceDefinitions.length + 1;
    const collectorCounts: Record<string, number> = {};
    const collectorTotals: Record<string, number> = {};
    const collectedSources: CollectedUsageSource[] = [];
    let completedCollectors = 0;
    let scanRecordCreated = false;

    await acquireScanLock(scanId);

    const runningRecord: KvScanRecord = {
        _key: scanId,
        scan_id: scanId,
        scan_type: 'usage',
        status: 'running',
        started_at: startedAt,
        completed_at: null,
        object_count: 0,
        edge_count: 0,
        finding_count: 0,
        warnings: [],
        errors: [],
        collector_counts: {},
        collector_totals: {},
        analysis_status: 'pending',
        inventory_scan_id: inventoryRecord.scan_id,
        usage_window_days: windowDays,
        usage_window_start: windowStart,
        usage_window_end: windowEnd,
        usage_coverage: 'unavailable',
        collector_versions: {
            usage_evidence: '0.1.0',
            usage_classification: '0.1.0',
        },
        initiated_by: username || 'unknown',
    };

    try {
        await createRecord('ch_scan_runs', runningRecord);
        scanRecordCreated = true;

        /* eslint-disable no-restricted-syntax, no-await-in-loop -- usage searches run serially to keep search-head load bounded. */
        for (const definition of usageSourceDefinitions) {
            onProgress?.({
                completedCollectors,
                totalCollectors,
                stage: `Collecting ${definition.label.toLowerCase()}`,
            });
            let collected: CollectedUsageSource;
            try {
                collected = await collectUsageSource(
                    definition,
                    windowDays,
                    windowStart,
                    windowEnd
                );
            } catch (error) {
                collected = unavailableUsageSource(
                    definition,
                    error instanceof Error
                        ? error.message
                        : 'The telemetry search failed.'
                );
            }
            collectedSources.push(collected);
            collectorCounts[definition.sourceId] =
                collected.summary.activityRecordCount;
            collectorTotals[definition.sourceId] =
                collected.summary.sourceEventCount;
            completedCollectors += 1;
            await updateRecord('ch_scan_runs', scanId, {
                collector_counts: collectorCounts,
                collector_totals: collectorTotals,
                completed_collectors: completedCollectors,
                total_collectors: totalCollectors,
            });
        }
        /* eslint-enable no-restricted-syntax, no-await-in-loop */

        onProgress?.({
            completedCollectors,
            totalCollectors,
            stage: 'Matching usage evidence to inventory objects',
        });
        const built = buildUsageEvidence(
            inventorySnapshot.objects,
            scanId,
            inventoryRecord.scan_id,
            windowDays,
            windowStart,
            windowEnd,
            collectedSources
        );
        const usageRecords = built.records.map(({ objectId, usage }) =>
            usageEvidenceToRecord(objectId, usage)
        );
        await batchSave('ch_usage_evidence', usageRecords);
        completedCollectors += 1;

        const coverage = combinedUsageCoverage(built.sources);
        const status = usageScanStatus(coverage);
        const completedAt = new Date().toISOString();
        const completedRecord: KvScanRecord = {
            ...runningRecord,
            status,
            completed_at: completedAt,
            object_count: usageRecords.length,
            warnings: built.warnings,
            errors:
                coverage === 'unavailable'
                    ? [
                          'No configured telemetry source established a usable observation window.',
                      ]
                    : [],
            collector_counts: collectorCounts,
            collector_totals: collectorTotals,
            analysis_status: usageAnalysisStatus(coverage),
            completed_collectors: completedCollectors,
            total_collectors: totalCollectors,
            duration_ms: Date.now() - new Date(startedAt).getTime(),
            usage_coverage: coverage,
            eligible_object_count: usageRecords.length,
            fully_covered_object_count: usageRecords.filter(
                (record) => record.coverage === 'complete'
            ).length,
            observed_object_count: usageRecords.filter(
                (record) => record.observation_count > 0
            ).length,
            usage_sources: built.sources.map((source) => ({ ...source })),
        };
        await updateRecord('ch_scan_runs', scanId, completedRecord);
        onProgress?.({
            completedCollectors,
            totalCollectors,
            stage: 'Loading usage-enriched inventory',
        });
        return loadSnapshot(inventoryRecord, completedRecord);
    } catch (error) {
        if (scanRecordCreated) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown usage collection failure';
            await updateRecord('ch_scan_runs', scanId, {
                status: 'failed',
                completed_at: new Date().toISOString(),
                errors: [message],
                collector_counts: collectorCounts,
                collector_totals: collectorTotals,
                analysis_status: 'failed',
            }).catch(() => undefined);
        }
        throw error;
    } finally {
        await releaseScanLock(scanId).catch(() => undefined);
    }
}

async function runBoundedScan(
    onProgress?: (progress: ScanProgress) => void
): Promise<InventorySnapshot> {
    return runInventoryScan('bounded', onProgress);
}

async function runFullScan(
    onProgress?: (progress: ScanProgress) => void
): Promise<InventorySnapshot> {
    return runInventoryScan('full', onProgress);
}

export const splunkInventoryClient: InventoryClient = {
    isAvailable: () => Boolean(splunkdPath),
    getLatestSnapshot,
    runBoundedScan,
    runFullScan,
    runUsageScan,
};
