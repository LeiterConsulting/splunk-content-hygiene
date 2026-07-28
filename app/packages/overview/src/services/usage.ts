import {
    ContentFinding,
    ContentObject,
    UsageActivityKind,
    UsageCoverage,
    UsageEvidence,
    UsageSourceSummary,
    UsageWindowDays,
} from '../types';

export const SEARCH_AUDIT_SOURCE_ID = 'search_audit';
export const DASHBOARD_ACCESS_SOURCE_ID = 'dashboard_access';

const COVERAGE_TOLERANCE_MS = 36 * 60 * 60 * 1000;

export interface UsageActivityAggregate {
    app: string;
    name: string;
    user: string | null;
    observationCount: number;
    successfulCount: number;
    failedCount: number;
    skippedCount: number;
    lastObserved: string | null;
}

export interface CollectedUsageSource {
    summary: UsageSourceSummary;
    activities: UsageActivityAggregate[];
}

export interface BuiltUsageEvidence {
    records: Array<{ objectId: string; usage: UsageEvidence }>;
    sources: UsageSourceSummary[];
    warnings: string[];
}

export type UsageEvidenceState =
    | 'observed'
    | 'no_observations_complete'
    | 'partial'
    | 'unavailable'
    | 'not_measured';

function timestamp(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values));
}

function normalizedIdentity(app: string, name: string): string {
    return `${app.trim().toLowerCase()}::${name.trim().toLowerCase()}`;
}

export function usageSourceForObject(
    contentObject: ContentObject
): {
    sourceId: string;
    sourceLabel: string;
    activityKind: UsageActivityKind;
} | null {
    if (
        contentObject.objectType === 'Saved Search' ||
        contentObject.objectType === 'Report' ||
        contentObject.objectType === 'Alert'
    ) {
        return {
            sourceId: SEARCH_AUDIT_SOURCE_ID,
            sourceLabel: 'Splunk search audit',
            activityKind: 'saved_search_execution',
        };
    }
    if (contentObject.objectType === 'Dashboard') {
        return {
            sourceId: DASHBOARD_ACCESS_SOURCE_ID,
            sourceLabel: 'Splunk Web access log',
            activityKind: 'dashboard_view',
        };
    }
    return null;
}

export function sourceCoverageForWindow(
    sourceEventCount: number,
    coverageStart: string | null,
    coverageEnd: string | null,
    windowStart: string,
    windowEnd: string
): UsageCoverage {
    if (sourceEventCount <= 0) {
        return 'unavailable';
    }
    const first = timestamp(coverageStart);
    const last = timestamp(coverageEnd);
    const requestedStart = timestamp(windowStart);
    const requestedEnd = timestamp(windowEnd);
    if (
        first === null ||
        last === null ||
        requestedStart === null ||
        requestedEnd === null
    ) {
        return 'partial';
    }
    return first <= requestedStart + COVERAGE_TOLERANCE_MS &&
        last >= requestedEnd - COVERAGE_TOLERANCE_MS
        ? 'complete'
        : 'partial';
}

function selectActivityObject(
    candidates: ContentObject[],
    activity: UsageActivityAggregate
): ContentObject | null {
    if (candidates.length === 1) {
        return candidates[0];
    }
    if (activity.user) {
        const privateMatch = candidates.find(
            (contentObject) =>
                contentObject.sharing === 'user' &&
                contentObject.owner === activity.user
        );
        if (privateMatch) {
            return privateMatch;
        }
    }
    const shared = candidates.filter(
        (contentObject) => contentObject.sharing !== 'user'
    );
    return shared.length === 1 ? shared[0] : null;
}

function observationEvidence(
    activityKind: UsageActivityKind,
    observationCount: number,
    windowDays: UsageWindowDays,
    lastObserved: string | null
): string {
    let noun = 'saved-search executions';
    if (activityKind === 'dashboard_view') {
        noun =
            observationCount === 1
                ? 'dashboard access'
                : 'dashboard accesses';
    } else if (observationCount === 1) {
        noun = 'saved-search execution';
    }
    return `Observed ${observationCount.toLocaleString()} ${noun} during the ${windowDays}-day evidence window${
        lastObserved ? `; the latest was ${lastObserved}` : ''
    }`;
}

function noObservationEvidence(
    activityKind: UsageActivityKind,
    coverage: UsageCoverage,
    windowDays: UsageWindowDays
): string {
    const activity =
        activityKind === 'dashboard_view'
            ? 'dashboard access'
            : 'saved-search execution';
    if (coverage === 'complete') {
        return `No ${activity} was observed during the complete ${windowDays}-day source window; this is evidence for review, not proof that the object is unused`;
    }
    if (coverage === 'partial') {
        return `No ${activity} was observed, but the ${windowDays}-day source window is only partially covered`;
    }
    return `No ${activity} conclusion is available because the telemetry source could not establish coverage`;
}

export function buildUsageEvidence(
    objects: ContentObject[],
    usageRunId: string,
    inventoryScanId: string,
    windowDays: UsageWindowDays,
    windowStart: string,
    windowEnd: string,
    collectedSources: CollectedUsageSource[]
): BuiltUsageEvidence {
    const eligibleBySourceAndIdentity = new Map<string, ContentObject[]>();
    objects.forEach((storedObject) => {
        const contentObject = storedObject;
        const source = usageSourceForObject(contentObject);
        if (!source) {
            return;
        }
        const key = `${source.sourceId}::${normalizedIdentity(
            contentObject.app,
            contentObject.canonicalName
        )}`;
        const existing = eligibleBySourceAndIdentity.get(key) ?? [];
        existing.push(contentObject);
        eligibleBySourceAndIdentity.set(key, existing);
    });

    const activityByObject = new Map<string, UsageActivityAggregate>();
    const matchedObjectIdsBySource = new Map<string, Set<string>>();
    const ambiguousCounts = new Map<string, number>();

    collectedSources.forEach((source) => {
        source.activities.forEach((activity) => {
            const key = `${source.summary.sourceId}::${normalizedIdentity(
                activity.app,
                activity.name
            )}`;
            const match = selectActivityObject(
                eligibleBySourceAndIdentity.get(key) ?? [],
                activity
            );
            if (!match) {
                ambiguousCounts.set(
                    source.summary.sourceId,
                    (ambiguousCounts.get(source.summary.sourceId) ?? 0) + 1
                );
                return;
            }
            const previous = activityByObject.get(match.objectId);
            activityByObject.set(match.objectId, {
                app: match.app,
                name: match.canonicalName,
                user: null,
                observationCount:
                    (previous?.observationCount ?? 0) +
                    activity.observationCount,
                successfulCount:
                    (previous?.successfulCount ?? 0) +
                    activity.successfulCount,
                failedCount:
                    (previous?.failedCount ?? 0) + activity.failedCount,
                skippedCount:
                    (previous?.skippedCount ?? 0) + activity.skippedCount,
                lastObserved:
                    !previous?.lastObserved ||
                    (activity.lastObserved &&
                        activity.lastObserved > previous.lastObserved)
                        ? activity.lastObserved
                        : previous.lastObserved,
            });
            const matched =
                matchedObjectIdsBySource.get(source.summary.sourceId) ??
                new Set<string>();
            matched.add(match.objectId);
            matchedObjectIdsBySource.set(source.summary.sourceId, matched);
        });
    });

    const sources = collectedSources.map((source) => {
        const ambiguous = ambiguousCounts.get(source.summary.sourceId) ?? 0;
        const warningParts = [
            source.summary.warning,
            ambiguous > 0
                ? `${ambiguous.toLocaleString()} activity row${
                      ambiguous === 1 ? '' : 's'
                  } could not be mapped uniquely to an inventory object.`
                : null,
        ].filter((value): value is string => Boolean(value));
        return {
            ...source.summary,
            matchedObjectCount:
                matchedObjectIdsBySource.get(source.summary.sourceId)?.size ?? 0,
            warning: warningParts.length > 0 ? warningParts.join(' ') : null,
        };
    });

    const records = objects.reduce<
        Array<{ objectId: string; usage: UsageEvidence }>
    >((builtRecords, contentObject) => {
        const sourceDescriptor = usageSourceForObject(contentObject);
        if (!sourceDescriptor) {
            return builtRecords;
        }
        const summary = sources.find(
            ({ sourceId }) => sourceId === sourceDescriptor.sourceId
        );
        const activity = activityByObject.get(contentObject.objectId);
        const coverage = summary?.coverage ?? 'unavailable';
        const observationCount = activity?.observationCount ?? 0;
        const evidence = [
            observationCount > 0
                ? observationEvidence(
                      sourceDescriptor.activityKind,
                      observationCount,
                      windowDays,
                      activity?.lastObserved ?? null
                  )
                : noObservationEvidence(
                      sourceDescriptor.activityKind,
                      coverage,
                      windowDays
                  ),
            `Usage provenance: ${sourceDescriptor.sourceLabel}; requested window ${windowStart} through ${windowEnd}`,
        ];
        if (summary?.coverageStart || summary?.coverageEnd) {
            evidence.push(
                `Observed source coverage: ${
                    summary.coverageStart ?? 'unknown'
                } through ${summary.coverageEnd ?? 'unknown'}`
            );
        }
        builtRecords.push(
            {
                objectId: contentObject.objectId,
                usage: {
                    usageRunId,
                    inventoryScanId,
                    sourceId: sourceDescriptor.sourceId,
                    sourceLabel: sourceDescriptor.sourceLabel,
                    activityKind: sourceDescriptor.activityKind,
                    windowDays,
                    windowStart,
                    windowEnd,
                    coverage,
                    coverageStart: summary?.coverageStart ?? null,
                    coverageEnd: summary?.coverageEnd ?? null,
                    sourceEventCount: summary?.sourceEventCount ?? 0,
                    observationCount,
                    successfulCount: activity?.successfulCount ?? 0,
                    failedCount: activity?.failedCount ?? 0,
                    skippedCount: activity?.skippedCount ?? 0,
                    lastObserved: activity?.lastObserved ?? null,
                    evidence,
                },
            },
        );
        return builtRecords;
    }, []);

    return {
        records,
        sources,
        warnings: sources.reduce<string[]>((sourceWarnings, source) => {
            if (source.warning) {
                sourceWarnings.push(`${source.label}: ${source.warning}`);
            }
            return sourceWarnings;
        }, []),
    };
}

function daysBetween(later: string, earlier: string): number | null {
    const laterTime = timestamp(later);
    const earlierTime = timestamp(earlier);
    if (laterTime === null || earlierTime === null) {
        return null;
    }
    return Math.max(0, Math.floor((laterTime - earlierTime) / 86400000));
}

function usageFinding(
    contentObject: ContentObject,
    usage: UsageEvidence,
    abandonmentConfidence: number,
    scheduledGap: boolean
): ContentFinding {
    const reasons = [
        usage.evidence[0],
        scheduledGap
            ? 'The object is enabled and scheduled but no execution was observed in the complete telemetry window'
            : 'No inbound relationships were produced by the supported parsers',
        'Owner confirmation is still required; absence of observed activity is not proof of safe removal',
    ];
    return {
        findingId: `usage-no-observation::${contentObject.objectId}`,
        objectId: contentObject.objectId,
        findingType: 'needs_review',
        abandonmentConfidence,
        removalImpact: contentObject.removalImpact,
        reasons,
        suggestedAction: scheduledGap
            ? 'Validate the schedule, execution permissions, and scheduler health before considering cleanup'
            : 'Confirm intent with the owner and review usage and dependency evidence before any separate cleanup action',
        createdAt: usage.windowEnd,
    };
}

export function applyUsageEvidence(
    inputObjects: ContentObject[],
    inputFindings: ContentFinding[],
    evidenceRecords: Array<{ objectId: string; usage: UsageEvidence }>,
    currentInventoryScanId: string
): { objects: ContentObject[]; findings: ContentFinding[] } {
    const usageByObject = new Map(
        evidenceRecords.map(({ objectId, usage }) => [objectId, usage])
    );
    const objects = inputObjects.map((contentObject) => ({
        ...contentObject,
        evidence: [...contentObject.evidence],
        usageEvidence: usageByObject.get(contentObject.objectId) ?? null,
    }));
    let findings = inputFindings.filter(
        (finding) => !finding.findingId.startsWith('usage-no-observation::')
    );

    objects.forEach((storedObject) => {
        const contentObject = storedObject;
        const usage = contentObject.usageEvidence;
        if (!usage) {
            return;
        }
        contentObject.evidence = unique([
            ...contentObject.evidence,
            ...usage.evidence,
        ]);
        if (usage.lastObserved) {
            contentObject.lastUsed = usage.lastObserved;
        }

        const matchesInventory =
            usage.inventoryScanId === currentInventoryScanId;
        const objectUpdatedAfterWindow =
            contentObject.updated !== null &&
            contentObject.updated > usage.windowEnd;
        if (!matchesInventory || objectUpdatedAfterWindow) {
            contentObject.evidence = unique([
                ...contentObject.evidence,
                'Usage evidence predates the current object snapshot or its latest modification, so it did not change classification',
            ]);
            return;
        }

        if (usage.observationCount > 0 && usage.lastObserved) {
            const ageDays = daysBetween(usage.windowEnd, usage.lastObserved);
            const confidenceCeiling =
                ageDays !== null && ageDays <= 30 ? 5 : 20;
            contentObject.abandonmentConfidence = Math.min(
                contentObject.abandonmentConfidence ?? 100,
                confidenceCeiling
            );
            if (
                contentObject.healthStatus === 'unknown' ||
                contentObject.healthStatus === 'dormant'
            ) {
                contentObject.healthStatus = 'active';
                findings = findings.filter(
                    (finding) =>
                        finding.objectId !== contentObject.objectId ||
                        finding.findingType !== 'needs_review'
                );
            }
            contentObject.suggestedAction =
                'Review the observed activity and retain the object unless a separate investigation establishes a supported replacement or retirement plan';
            return;
        }

        if (usage.coverage !== 'complete') {
            return;
        }

        const scheduledGap =
            contentObject.scheduled === true &&
            contentObject.enabled !== false;
        if (
            !contentObject.protected &&
            contentObject.healthStatus !== 'broken' &&
            contentObject.healthStatus !== 'unowned' &&
            !scheduledGap
        ) {
            contentObject.healthStatus = 'dormant';
        }
        const evidenceConfidence = Math.min(
            80,
            50 + Math.round(usage.windowDays / 6)
        );
        contentObject.abandonmentConfidence = Math.max(
            contentObject.abandonmentConfidence ?? 0,
            evidenceConfidence
        );
        if (
            !contentObject.protected &&
            contentObject.healthStatus !== 'broken' &&
            contentObject.healthStatus !== 'unowned' &&
            (scheduledGap || contentObject.inboundReferences === 0)
        ) {
            findings = findings.filter(
                (finding) =>
                    finding.objectId !== contentObject.objectId ||
                    finding.findingType !== 'needs_review'
            );
            const finding = usageFinding(
                contentObject,
                usage,
                contentObject.abandonmentConfidence,
                scheduledGap
            );
            findings.push(finding);
            contentObject.suggestedAction = finding.suggestedAction;
        }
    });

    return { objects, findings };
}

export function usageEvidenceState(
    contentObject: ContentObject
): UsageEvidenceState {
    const usage = contentObject.usageEvidence;
    if (!usage) {
        return 'not_measured';
    }
    if (usage.observationCount > 0) {
        return 'observed';
    }
    if (usage.coverage === 'complete') {
        return 'no_observations_complete';
    }
    return usage.coverage;
}

export function usageCoverageLabel(coverage: UsageCoverage): string {
    if (coverage === 'complete') {
        return 'Complete window';
    }
    if (coverage === 'partial') {
        return 'Partial window';
    }
    return 'Unavailable';
}
