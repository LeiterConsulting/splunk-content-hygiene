import { ContentObject, ReviewRecord, ScanSummary } from '../types';
import { PolicyProtection } from './appPolicies';
import { compareReviewEvidence, reviewValidityLabels } from './reviewEvidence';
import { reviewStageOptions } from './reviews';
import { evidenceWindowFresh, usageValidity } from './usage';
import { SHARED_STATIC_POLICY } from './dependencyCoverage';

export type BriefAction = 'changes' | 'usage' | 'coverage' | 'relationships' | 'decision' | 'scan';
export interface BriefIdentity { objectId: string; name: string; objectType: string; app: string }
export interface InvestigationBriefInput {
    identity: BriefIdentity;
    object?: ContentObject | null;
    scan?: ScanSummary | null;
    review?: ReviewRecord | null;
    reviewsVerified?: boolean;
    protection?: PolicyProtection | null;
    now?: number;
}
export const BRIEF_LIMITATION = 'This is a summary of captured evidence, not live verification, complete dependency coverage or removal approval. Suggested checks only open evidence; they do not collect data or save a decision.';
export const BRIEF_TEXT_LIMIT = 320;
export const BRIEF_REASON_LIMIT = 6;
const compact = (value: string): string => value.length > BRIEF_TEXT_LIMIT
    ? `${value.slice(0, BRIEF_TEXT_LIMIT)}… [summary; inspect full evidence]` : value;
const stamp = (value: string | null | undefined): string | null => value && Number.isFinite(Date.parse(value)) ? value : null;
const count = (value: number | undefined): number | null => Number.isSafeInteger(value) && value! >= 0 ? value! : null;
const whyLabels: Record<ContentObject['healthStatus'], string> = {
    active: 'No cleanup concern is currently flagged; this object was selected for investigation.',
    dormant: 'Available evidence identifies a review candidate, not proof that it is unused.',
    orphaned: 'Captured relationship evidence identifies a concern to investigate.',
    broken: 'A captured reference needs investigation; this is not a removal recommendation.',
    unowned: 'Ownership needs confirmation before relying on a cleanup decision.',
    protected: 'Built-in or system protection applies; this is not a routine cleanup candidate.',
    unknown: 'Available evidence does not support a firm current classification.',
};

/** Selected cached object only. No graph reconstruction, native reads or writes. */
export function investigationBrief(input: InvestigationBriefInput) {
    const { identity, scan, protection } = input;
    const now = input.now ?? Date.now();
    const supplied = input.object;
    const matched = Boolean(supplied && supplied.objectId === identity.objectId);
    const scopeMismatch = Boolean(matched && scan && supplied!.inventoryScanId && supplied!.inventoryScanId !== scan.scanId);
    const object = matched && scan && !scopeMismatch ? supplied! : null;
    const matchedReview = input.review?.objectId === identity.objectId ? input.review : null;
    const reviewsVerified = input.reviewsVerified !== false;
    const review = matchedReview && !reviewsVerified ? { ...matchedReview, persistenceIssue: 'The saved review library has not been verified; its retained decision is not a current confirmation.' } : matchedReview;
    const comparison = compareReviewEvidence(review, object, scan, now);
    const capturedAt = stamp(scan?.completedAt ?? scan?.startedAt);
    const snapshotRecent = Boolean(capturedAt && evidenceWindowFresh(capturedAt, now));
    let presence = 'not_observed';
    if (object) { presence = 'captured'; }
    else if (!scan || scopeMismatch || supplied && !matched) { presence = 'unavailable'; }
    const validity = object ? usageValidity(object, scan?.scanId, now) : null;
    const usage = object?.usageEvidence;
    let usageLabel = 'Current usage is unknown because the current object cannot be verified.';
    if (validity === 'unsupported') { usageLabel = 'Direct usage telemetry is not attributable to this object type; investigate its callers.'; }
    else if (validity === 'not_measured') { usageLabel = 'No usage window has been measured; inactivity is unknown.'; }
    else if (validity && validity !== 'current') { usageLabel = 'Historical usage cannot establish current activity or inactivity.'; }
    else if (usage) {
        if (usage.observationCount > 0) { usageLabel = `${usage.observationCount.toLocaleString()} attributable activity observation(s) in the captured ${usage.windowDays}-day window (${usage.coverage} source coverage).`; }
        else if (usage.coverage === 'complete') { usageLabel = 'No activity observed in the covered window; this does not prove the object is unused.'; }
        else { usageLabel = 'No activity observed, but the source window is incomplete; inactivity is unknown.'; }
    }
    const issues: string[] = [];
    if (!reviewsVerified) { issues.push('Saved review status is unverified while the library is loading or unavailable; no missing decision is inferred.'); }
    if (!object) {
        if (scopeMismatch || supplied && !matched) { issues.push('Object identity or source-scan provenance does not match this investigation.'); }
        else if (scan) { issues.push('This identity is not observed in the cached inventory. Removal, rename and visibility remain unverified.'); }
        else { issues.push('Current inventory is unavailable. Saved identity and decisions are not current presence evidence.'); }
    }
    if (review && comparison.status !== 'current') { issues.push(...comparison.reasons, ...comparison.limitations); }
    if (input.review && !review) { issues.push('The supplied review belongs to another identity; no decision is inferred from it.'); }
    if (scan && !snapshotRecent) { issues.push('Snapshot age does not meet the existing seven-day freshness check, or its timestamp is invalid.'); }
    if (scan?.retainedBaseline) { issues.push('The latest check retained an earlier inventory baseline; this is not a newly completed observation.'); }
    const scanUnusable = Boolean(scan && (scan.errors.length || !['succeeded', 'partial'].includes(scan.status) || !['complete', 'partial'].includes(scan.analysisStatus)));
    if (scanUnusable) { issues.push('The snapshot reports collection/analysis failure or errors. Inspect scan coverage before interpreting missing evidence.'); }
    if (object) { issues.push(...(object.reviewEvidence?.limitations ?? [])); }
    const coverage = object?.reviewEvidence?.coverage;
    if (object && !coverage) { issues.push('Object-scoped configuration, access and relationship coverage is not recorded in this snapshot.'); }
    if (coverage && coverage.policy !== SHARED_STATIC_POLICY) { issues.push('This snapshot predates the current dependency-coverage policy; expanded coverage has not been verified.'); }
    if (coverage) {
        const areas = [['configuration', 'Configuration'], ['access', 'Access'], ['inbound', 'Incoming relationships'], ['outbound', 'Outgoing relationships']] as const;
        areas.forEach(([key, label]) => {
            if (coverage[key].status !== 'complete') {
                issues.push(`${label} coverage is ${coverage[key].status}; ${coverage[key].reasons[0] ?? 'inspect the captured coverage details'}`);
            }
        });
    }
    if (object?.analysisWarnings?.length) { issues.push(`${object.analysisWarnings.length} captured parser/analysis limitation(s); inspect the source evidence before interpreting missing links.`); }
    if (object && (validity === 'not_measured' || validity && !['current', 'unsupported'].includes(validity) || validity === 'current' && usage?.coverage !== 'complete')) { issues.push(usageLabel); }
    if (object && validity === 'unsupported') { issues.push('Direct activity is not measured for this type. Calling searches or dashboards and external consumers require separate investigation.'); }
    const policyMismatch = Boolean(protection?.policy && protection.policy.app_id !== identity.app);
    let protectionLabel: string | null = null;
    if (policyMismatch) { protectionLabel = 'Retention policy scope cannot be matched to this identity; protection is unverified.'; }
    else if (protection?.conflict) { protectionLabel = 'Saved eligibility conflicts with app retention. Both remain unchanged; resolve protection explicitly before cleanup.'; }
    else if (protection?.status === 'retained') { protectionLabel = 'An exact-app Retain policy applies independently of the saved individual decision.'; }
    else if (protection && ['scope_unverified', 'store_unverified'].includes(protection.status)) { protectionLabel = 'App retention protection cannot be verified; absence of protection is not established.'; }
    if (protectionLabel && (policyMismatch || protection?.conflict || protection?.status === 'scope_unverified' || protection?.status === 'store_unverified')) { issues.unshift(protectionLabel); }
    if (object?.protected) { protectionLabel = ['Built-in/system protection applies.', protectionLabel].filter(Boolean).join(' '); }
    const incoming = object ? count(object.inboundReferences) : null;
    const outgoing = object ? count(object.outboundReferences) : null;
    if (object && (incoming === null || outgoing === null)) { issues.push('Captured relationship counts cannot be verified. Unknown counts are not zero links.'); }
    let nextCheck: { action: BriefAction; label: string; reason: string };
    if (!object) { nextCheck = review ? { action: 'changes', label: 'Inspect evidence & changes', reason: 'Compare the saved identity and evidence without assuming the object was removed.' }
        : { action: 'scan', label: 'Inspect scan coverage', reason: 'Check the captured inventory and visibility before relying on this identity. Opening Settings does not run a scan.' }; }
    else if (review && ['needs_review', 'cannot_verify'].includes(comparison.status)) { nextCheck = { action: 'changes', label: 'Inspect evidence & changes', reason: 'Review the changed or unverifiable evidence before relying on the saved decision.' }; }
    else if (!reviewsVerified) { nextCheck = { action: 'decision', label: 'Inspect saved review status', reason: 'Inspect the unverified library status before assuming this object has no saved decision. This does not save a review.' }; }
    else if (policyMismatch || protection?.conflict || protection?.status === 'scope_unverified' || protection?.status === 'store_unverified') { nextCheck = { action: 'decision', label: 'Inspect decision & protection', reason: 'Inspect the preserved decision and retention context; this action does not change either.' }; }
    else if (!snapshotRecent || scan?.retainedBaseline || scanUnusable) { nextCheck = { action: 'scan', label: 'Inspect snapshot coverage & freshness', reason: 'Inspect the capture time, coverage and scan status. Any new collection requires a separate explicit action.' }; }
    else if (validity && !['current', 'unsupported'].includes(validity) || validity === 'current' && usage?.coverage !== 'complete') { nextCheck = { action: 'usage', label: 'Inspect usage evidence', reason: 'Check the source window and freshness before interpreting activity or inactivity.' }; }
    else if (!coverage || coverage.policy !== SHARED_STATIC_POLICY || Object.values(coverage).some(area => typeof area === 'object' && area.status !== 'complete') || object.analysisWarnings?.length || object.reviewEvidence?.limitations.length || incoming === null || outgoing === null) { nextCheck = { action: 'coverage', label: 'Inspect dependency evidence', reason: 'Inspect this object’s captured source and coverage limits; missing links are not absence.' }; }
    else { nextCheck = { action: 'relationships', label: 'Inspect captured relationships', reason: 'Open this object’s unfiltered captured links. Static references do not establish execution or complete consumers.' }; }
    const allIssues = [...new Set(issues)];
    const evidenceStatus = !reviewsVerified && !review ? 'cannot_verify' : comparison.status;
    let stageLabel = reviewsVerified ? 'No saved decision' : 'Unknown — library not verified';
    if (review) { stageLabel = reviewStageOptions.find(row => row.value === review.stage)?.label ?? 'Unknown saved stage'; }
    let ageState = 'unavailable';
    if (scan) { ageState = snapshotRecent ? 'recent' : 'historical_or_invalid'; }
    return {
        version: 1 as const,
        asOf: Number.isFinite(now) && Math.abs(now) <= 8640000000000000 ? new Date(now).toISOString() : null,
        object: { objectId: identity.objectId, name: identity.name, objectType: identity.objectType, app: identity.app, presence, healthStatus: object?.healthStatus ?? null },
        snapshot: { scanId: scan?.scanId ?? null, capturedAt, ageState, retainedBaseline: Boolean(scan?.retainedBaseline), globalWarningCount: scan?.warningCount ?? null },
        decision: { stage: review?.stage ?? null, label: `${review?.removed ? 'Archived — ' : ''}${stageLabel}`, archived: Boolean(review?.removed), verified: reviewsVerified, evidenceStatus, evidenceLabel: reviewValidityLabels[evidenceStatus] },
        why: { summary: object ? whyLabels[object.healthStatus] : 'The saved or requested identity is retained, but its current state cannot be established.', recordedReason: object?.evidence[0] ? compact(object.evidence[0]) : null },
        known: { incoming, outgoing, usageValidity: validity, usageLabel, usageWindowEnded: usage?.windowEnd ?? null },
        uncertainty: { count: allIssues.length, summaries: allIssues.slice(0, BRIEF_REASON_LIMIT).map(compact), moreAvailable: allIssues.length > BRIEF_REASON_LIMIT || allIssues.some(row => row.length > BRIEF_TEXT_LIMIT), preview: allIssues.length ? compact(allIssues[0]) : 'No additional issue recorded in these captured checks; runtime and external consumers remain unverified.' },
        protection: protectionLabel,
        nextCheck,
        limitation: BRIEF_LIMITATION,
    };
}
export type InvestigationBriefReport = ReturnType<typeof investigationBrief>;

export function investigationBriefCsv(report: InvestigationBriefReport) {
    return {
        columns: ['Summary version', 'Summary as of', 'Object ID', 'Name', 'Type', 'App', 'Current presence', 'Captured health status', 'Snapshot scan ID', 'Snapshot captured', 'Snapshot age state', 'Retained baseline', 'Environment-wide collector warnings', 'Saved decision stage', 'Saved decision', 'Archived decision', 'Review library verified', 'Evidence status', 'Evidence status label', 'Why review', 'Recorded reason summary', 'Captured incoming links', 'Captured outgoing links', 'Usage validity', 'Usage summary', 'Usage window ended', 'Protection', 'Uncertainty count', 'Uncertainty preview', 'Uncertainty summaries', 'More evidence available', 'Next check', 'Next check action', 'Next check reason', 'Summary limitation'],
        rows: [[report.version, report.asOf, report.object.objectId, report.object.name, report.object.objectType, report.object.app, report.object.presence, report.object.healthStatus, report.snapshot.scanId, report.snapshot.capturedAt, report.snapshot.ageState, report.snapshot.retainedBaseline, report.snapshot.globalWarningCount, report.decision.stage, report.decision.label, report.decision.archived, report.decision.verified, report.decision.evidenceStatus, report.decision.evidenceLabel, report.why.summary, report.why.recordedReason, report.known.incoming, report.known.outgoing, report.known.usageValidity, report.known.usageLabel, report.known.usageWindowEnded, report.protection, report.uncertainty.count, report.uncertainty.preview, JSON.stringify(report.uncertainty.summaries), report.uncertainty.moreAvailable, report.nextCheck.label, report.nextCheck.action, report.nextCheck.reason, report.limitation]],
    };
}
