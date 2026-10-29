import { BRIEF_REASON_LIMIT, BRIEF_TEXT_LIMIT, investigationBrief, investigationBriefCsv } from '../services/investigationBrief';
import { compareReviewEvidence } from '../services/reviewEvidence';
import { appPolicyFixture } from './appPolicyFixtures';
import { briefFixture } from './investigationBriefFixtures';
import { object, review } from './milestoneFixtures';

test('a brief preserves a saved decision, uses the shared comparison and never grants removal approval', () => {
    const { item, data, saved, now, identity } = briefFixture();
    const bytes = JSON.stringify([item, data, saved]);
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    expect(report.decision.stage).toBe('confirmed_eligible');
    expect(report.decision.evidenceStatus).toBe(compareReviewEvidence(saved, item, data.scan, now).status);
    expect(report.decision.evidenceStatus).toBe('current');
    expect(report.known).toMatchObject({ incoming: 0, outgoing: 0, usageValidity: 'unsupported' });
    expect(report.nextCheck.action).toBe('relationships');
    expect(report.limitation).toMatch(/not live verification, complete dependency coverage or removal approval/);
    expect(JSON.stringify([item, data, saved])).toBe(bytes);
});

test('a projection without graph and caller diagnostics produces the same selected-object brief', () => {
    const { item, data, saved, now, identity } = briefFixture('Report');
    const full = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    const projected = { ...item }; delete projected.callerContext;
    expect(investigationBrief({ identity, object: projected, scan: data.scan, review: saved, now })).toEqual(full);
    expect(full.known.usageLabel).toMatch(/5 attributable activity/);
    expect(full.nextCheck.action).toBe('relationships');
});

test.each([null, undefined])('no current object (%s) is unknown, never a historical zero-link substitution', supplied => {
    const { data, saved, now, identity } = briefFixture();
    const report = investigationBrief({ identity, object: supplied, scan: data.scan, review: saved, now });
    expect(report.object.presence).toBe('not_observed');
    expect(report.known.incoming).toBeNull(); expect(report.known.outgoing).toBeNull();
    expect(report.decision.stage).toBe('confirmed_eligible'); expect(report.decision.evidenceStatus).toBe('cannot_verify');
    expect(report.nextCheck.action).toBe('changes'); expect(report.uncertainty.preview).toMatch(/Removal, rename and visibility remain unverified/);
});

test('unavailable inventory does not establish current presence or absence', () => {
    const { item, saved, now, identity } = briefFixture();
    const report = investigationBrief({ identity, object: item, review: saved, now });
    expect(report.object.presence).toBe('unavailable'); expect(report.known.incoming).toBeNull();
    expect(report.uncertainty.preview).toMatch(/Current inventory is unavailable/);
});

test.each(['identity', 'scan'])('mismatched %s cannot supply current counts', mismatch => {
    const { item, data, saved, now, identity } = briefFixture();
    if (mismatch === 'identity') { item.objectId = 'different'; } else { item.inventoryScanId = 'different'; }
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    expect(report.object.presence).toBe('unavailable'); expect(report.known.incoming).toBeNull();
    expect(report.uncertainty.preview).toMatch(/provenance does not match/);
});

test('a different identity’s review is ignored without changing it', () => {
    const { item, data, now, identity } = briefFixture(); const other = review('other');
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: other, now });
    expect(report.decision.stage).toBeNull(); expect(report.uncertainty.summaries.join(' ')).toMatch(/another identity/);
    expect(other.stage).toBe('retain');
});

test.each([true, false])('unverified library preserves a known decision (%s), never inferring no saved decision', exists => {
    const { item, data, saved, now, identity } = briefFixture(); const bytes = JSON.stringify(saved);
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: exists ? saved : null, reviewsVerified: false, now });
    expect(report.decision.verified).toBe(false); expect(report.uncertainty.preview).toMatch(/Saved review status is unverified/);
    if (exists) { expect(report.decision.stage).toBe('confirmed_eligible'); expect(report.decision.evidenceStatus).toBe('cannot_verify'); }
    else { expect(report.decision.label).toBe('Unknown — library not verified'); expect(report.decision.evidenceStatus).toBe('cannot_verify'); expect(report.nextCheck.action).toBe('decision'); }
    expect(JSON.stringify(saved)).toBe(bytes);
});

test('changed evidence takes priority without overwriting an eligible decision', () => {
    const { item, data, saved, now, identity } = briefFixture(); item.reviewEvidence!.enabled = false;
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    expect(report.decision.stage).toBe('confirmed_eligible'); expect(report.decision.evidenceStatus).toBe('needs_review');
    expect(report.nextCheck.action).toBe('changes');
});

test('persistence and baseline limitations remain visible even when no configuration changed', () => {
    const { item, data, saved, now, identity } = briefFixture(); saved.persistenceIssue = 'Concurrent review heads are unverified.';
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    expect(report.decision.evidenceStatus).toBe('cannot_verify');
    expect(report.uncertainty.summaries).toContain(saved.persistenceIssue); expect(report.nextCheck.action).toBe('changes');
});

test('an archived decision remains labeled archived and is not an active confirmation', () => {
    const { item, data, saved, now, identity } = briefFixture(); saved.removed = true;
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    expect(report.decision).toMatchObject({ stage: 'confirmed_eligible', archived: true, evidenceStatus: 'unreviewed' });
    expect(report.decision.label).toMatch(/^Archived/);
});

test.each(['expired', 'invalid', 'future', 'retained', 'failed', 'errors'])('snapshot %s stays qualified and does not trigger a collection', state => {
    const { item, data, now, identity } = briefFixture();
    if (state === 'expired') { data.scan.completedAt = '2020-01-01T00:00:00Z'; }
    if (state === 'invalid') { data.scan.completedAt = 'invalid'; }
    if (state === 'future') { data.scan.completedAt = new Date(now + 86400000).toISOString(); }
    if (state === 'retained') { data.scan.retainedBaseline = true; }
    if (state === 'failed') { data.scan.status = 'failed'; }
    if (state === 'errors') { data.scan.errors = ['Read failed']; }
    const report = investigationBrief({ identity, object: item, scan: data.scan, now });
    if (state === 'retained') { expect(report.snapshot.retainedBaseline).toBe(true); }
    else { expect(report.nextCheck.action).toBe('scan'); }
    expect(report.limitation).toMatch(/do not collect data or save a decision/);
});

test('global partial status does not replace object-scoped coverage or the appropriate next check', () => {
    const { item, data, now, identity } = briefFixture('Report');
    data.scan.status = 'partial'; data.scan.analysisStatus = 'partial'; data.scan.warningCount = 15;
    item.usageEvidence = null;
    const report = investigationBrief({ identity, object: item, scan: data.scan, now });
    expect(report.snapshot.globalWarningCount).toBe(15); expect(report.nextCheck.action).toBe('usage');
    expect(report.uncertainty.summaries.join(' ')).not.toMatch(/collection\/analysis failure/);
});

test.each(['not_measured', 'historical', 'modified', 'expired', 'partial', 'zero'])('usage %s is separate from inactivity claims', state => {
    const { item, data, now, identity } = briefFixture('Report');
    if (state === 'not_measured') { item.usageEvidence = null; }
    if (state === 'historical') { item.usageEvidence!.inventoryScanId = 'old'; }
    if (state === 'modified') { item.updated = new Date(now).toISOString(); }
    if (state === 'expired') { item.usageEvidence!.windowEnd = '2020-01-01T00:00:00Z'; }
    if (state === 'partial') { item.usageEvidence!.coverage = 'partial'; item.usageEvidence!.observationCount = 0; }
    if (state === 'zero') { item.usageEvidence!.observationCount = 0; }
    const report = investigationBrief({ identity, object: item, scan: data.scan, now });
    expect(report.known.usageLabel).toMatch(state === 'zero' ? /does not prove/ : /unknown|cannot establish/);
    expect(report.nextCheck.action).toBe(state === 'zero' ? 'relationships' : 'usage');
});

test('missing configuration/access coverage is an investigation gap even with complete relationships', () => {
    const { item, data, now, identity } = briefFixture(); item.reviewEvidence!.coverage!.access.status = 'partial';
    const report = investigationBrief({ identity, object: item, scan: data.scan, now });
    expect(report.uncertainty.summaries.join(' ')).toMatch(/Access coverage is partial/); expect(report.nextCheck.action).toBe('coverage');
});

test.each([NaN, -1, Infinity])('invalid relationship count %s is unknown, never false zero', bad => {
    const { item, data, now, identity } = briefFixture(); item.inboundReferences = bad;
    const report = investigationBrief({ identity, object: item, scan: data.scan, now });
    expect(report.known.incoming).toBeNull(); expect(report.known.outgoing).toBe(0); expect(report.nextCheck.action).toBe('coverage');
});

test('policy conflict, unknown scope and built-in protection never silently replace the individual decision', () => {
    const { item, data, saved, now, identity } = briefFixture(); const { policy } = appPolicyFixture(); item.protected = true;
    const protection = { status: 'retained' as const, blocksCleanup: true, policy, conflict: true, detail: 'Conflict' };
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, protection, now });
    expect(report.protection).toMatch(/Built-in\/system protection.*conflicts with app retention/);
    expect(report.decision.stage).toBe('confirmed_eligible'); expect(report.nextCheck.action).toBe('decision');
    const wrong = investigationBrief({ identity: { ...identity, app: 'different' }, object: item, scan: data.scan, protection, now });
    expect(wrong.protection).toMatch(/scope cannot be matched/);
    const unknown = investigationBrief({ identity, object: item, scan: data.scan, protection: { ...protection, status: 'store_unverified', conflict: false, policy: null }, now });
    expect(unknown.protection).toMatch(/absence of protection is not established/);
});

test('large evidence is bounded without mutating or dropping the detailed source, and CSV matches the JSON summary', () => {
    const { item, data, now, identity } = briefFixture();
    item.evidence = ['Reason '.repeat(500)]; item.reviewEvidence!.limitations = Array.from({ length: 20 }, (_, i) => `${i}: ${'long '.repeat(200)}`);
    const bytes = JSON.stringify(item); const report = investigationBrief({ identity, object: item, scan: data.scan, now });
    expect(report.uncertainty.count).toBeGreaterThan(BRIEF_REASON_LIMIT);
    expect(report.uncertainty.summaries).toHaveLength(BRIEF_REASON_LIMIT); expect(report.uncertainty.moreAvailable).toBe(true);
    expect(report.uncertainty.summaries[0].length).toBeLessThan(BRIEF_TEXT_LIMIT + 60); expect(report.why.recordedReason).toMatch(/summary; inspect full evidence/);
    const csv = investigationBriefCsv(report); expect(csv.rows).toHaveLength(1); expect(csv.rows[0]).toHaveLength(csv.columns.length);
    expect(csv.rows[0][csv.columns.indexOf('Captured incoming links')]).toBe(report.known.incoming);
    expect(JSON.parse(String(csv.rows[0][csv.columns.indexOf('Uncertainty summaries')]))).toEqual(report.uncertainty.summaries);
    expect(JSON.stringify(item)).toBe(bytes);
});

test('a truly absent selected identity requests coverage, not the first object or another review', () => {
    const { data, now } = briefFixture(); const absent = object('absent');
    const report = investigationBrief({ identity: { objectId: absent.objectId, name: absent.name, objectType: absent.objectType, app: absent.app }, scan: data.scan, now });
    expect(report.object.objectId).toBe('absent'); expect(report.known.incoming).toBeNull(); expect(report.nextCheck.action).toBe('scan');
});
