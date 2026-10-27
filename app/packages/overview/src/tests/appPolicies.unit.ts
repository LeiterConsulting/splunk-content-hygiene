/* eslint-disable no-underscore-dangle -- Native policy identity contract. */
import { APP_POLICY_LIMIT, appPolicyKey, appPolicyStore, buildPolicyProtection, previewAppPolicy, readAppPolicy } from '../services/appPolicies';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { appPolicyFixture } from './appPolicyFixtures';
import { now, object } from './milestoneFixtures';

test('exact-app policy protects future shared objects without rewriting individual decisions', () => {
    const { data, policy, saved, first } = appPolicyFixture(); const original = JSON.stringify(saved);
    const future = object('macro::example::future');
    data.objects.push(future, { ...object('macro::renamed::future'), app: 'renamed' }, { ...object('private'), sharing: 'user' });
    const protection = buildPolicyProtection(data, appPolicyStore([policy]), [saved]);
    expect(protection.get(first.objectId)).toMatchObject({ status: 'retained', blocksCleanup: true, conflict: true });
    expect(protection.get(future.objectId)?.status).toBe('retained');
    expect(protection.get('macro::renamed::future')?.status).toBe('none');
    expect(protection.get('private')?.status).toBe('none');
    expect(JSON.stringify(saved)).toBe(original);
    expect(first.healthStatus).toBe('dormant');
});
test.each(['missing', 'renamed', 'configuration', 'access'] as const)('%s app scope blocks cleanup without fabricating verified policy roots', change => {
    const { data, app, policy, first } = appPolicyFixture();
    if (change === 'missing') { data.objects = data.objects.filter(row => row.objectId !== app.objectId); }
    else if (change === 'renamed') { app.canonicalName = 'new-app'; }
    else if (change === 'configuration') { app.configurationFingerprint.digest = 'b'.repeat(64); }
    else { app.configurationFingerprint.accessComplete = false; }
    const store = appPolicyStore([policy]);
    expect(buildPolicyProtection(data, store).get(first.objectId)).toMatchObject({ status: 'scope_unverified', blocksCleanup: true });
    const report = buildInUseReport(data, [], { activity: 'none', includeRetained: true, successfulOnly: false }, now, true, store);
    expect(report.rootCount).toBe(0); expect(report.gaps.some(row => row.includes('active app policy with unverified'))).toBe(true);
});
test('missing object does not get fabricated from an app policy; individual decision survives', () => {
    const { data, policy, saved, first } = appPolicyFixture();
    data.objects = data.objects.filter(row => row.objectId !== first.objectId);
    const reasons = buildPolicyProtection(data, appPolicyStore([policy]), [saved]);
    expect(reasons.has(first.objectId)).toBe(false);
    expect(saved.stage).toBe('confirmed_eligible');
});
test.each(['disabled', 'archived'] as const)('%s is reversible history, not deletion or a replacement decision', state => {
    const { data, policy, saved, first } = appPolicyFixture();
    const successor = { ...policy, _key: appPolicyKey('example', 2), parent_revision: policy._key, revision_number: 2, state };
    const store = appPolicyStore([successor, policy]);
    expect(store.verified).toBe(true); expect(store.revisions).toHaveLength(2);
    expect(buildPolicyProtection(data, store, [saved]).get(first.objectId)?.status).toBe('none');
    const restored = { ...policy, _key: appPolicyKey('example', 3), parent_revision: successor._key, revision_number: 3 };
    expect(buildPolicyProtection(data, appPolicyStore([policy, successor, restored]), [saved]).get(first.objectId)?.status).toBe('retained');
});
test.each(['duplicate', 'gap', 'parent', 'origin', 'actor', 'state', 'capacity'] as const)('malformed %s policy history fails closed', kind => {
    const { data, policy, first } = appPolicyFixture();
    let values: unknown[] = [policy];
    if (kind === 'duplicate') { values.push(policy); }
    else if (kind === 'gap') { values = [{ ...policy, _key: appPolicyKey('example', 2), parent_revision: policy._key, revision_number: 2 }]; }
    else if (kind === 'parent') { values = [{ ...policy, parent_revision: 'foreign' }]; }
    else if (kind === 'origin') { values.push({ ...policy, _key: appPolicyKey('example', 2), parent_revision: policy._key, revision_number: 2, created_at: new Date(now + 10).toISOString() }); }
    else if (kind === 'actor') { values = [{ ...policy, updated_by: '' }]; }
    else if (kind === 'state') { values = [{ ...policy, state: 'delete' }]; }
    else { values = Array(APP_POLICY_LIMIT + 1).fill(policy); }
    const store = appPolicyStore(values);
    expect(store.verified).toBe(false);
    expect(buildPolicyProtection(data, store).get(first.objectId)).toMatchObject({ status: 'store_unverified', blocksCleanup: true });
});
test('oversized policy history is rejected before inspecting any row', () => {
    const values = new Array(APP_POLICY_LIMIT + 1);
    Object.defineProperty(values, '0', { get() { throw new Error('Oversized history must not be parsed'); } });
    expect(appPolicyStore(values)).toMatchObject({ verified: false, heads: [], revisions: [] });
});
test('strict policy projection strips unknown fields and rejects foreign app identities', () => {
    const { policy } = appPolicyFixture();
    expect(readAppPolicy({ ...policy, rawCustomerData: 'not retained' })).toEqual(policy);
    expect(readAppPolicy({ ...policy, app_object_id: 'app::other::other' })).toBeNull();
});
test('prospective preview finds eligibility decisions before a policy exists and never calls unavailable history zero conflicts', () => {
    const { data, saved, first } = appPolicyFixture(); const bytes = JSON.stringify(saved);
    expect(buildPolicyProtection(data, appPolicyStore([]), [saved]).get(first.objectId)?.conflict).toBe(false);
    expect(previewAppPolicy(data, 'example', [saved], true)).toMatchObject({ eligibilityIds: [first.objectId], decisionsVerified: true });
    expect(previewAppPolicy(data, 'example', [], false).decisionsVerified).toBe(false);
    expect(previewAppPolicy(data, 'example', [{ ...saved, persistenceIssue: 'Unverified history' }], true).decisionsVerified).toBe(false);
    expect(previewAppPolicy(data, 'renamed', [saved], true).eligibilityIds).toEqual([]);
    expect(JSON.stringify(saved)).toBe(bytes);
});
test('required-content root provenance distinguishes policy retention, individual decision and observed use', () => {
    const { data, policy, saved, first, dependency } = appPolicyFixture();
    const bytes = JSON.stringify(saved);
    const store = appPolicyStore([policy]);
    const report = buildInUseReport(data, [saved], { activity: 'none', includeRetained: true, successfulOnly: false }, now, true, store);
    expect(report.rows.find(row => row.objectId === first.objectId)?.reasons).toMatchObject([{ kind: 'app_policy', policyConflict: true, revisionId: policy._key }]);
    expect(report.rows.find(row => row.objectId === dependency.objectId)?.via?.rootId).toBe(first.objectId);
    expect(report.rows.some(row => row.reasons.some(reason => reason.kind === 'observed' || reason.kind === 'retained'))).toBe(false);
    expect(report.appPolicies.revisions).toEqual([policy]);
    expect(JSON.stringify(saved)).toBe(bytes);
    const selected = buildInUseReport(data, [], { activity: 'none', includeRetained: true, successfulOnly: false, selectedIds: [dependency.objectId] }, now, true, store);
    expect(selected.rootCount).toBe(1); expect(selected.rows[0].reasons[0].kind).toBe('selected');
});
test('app policies block selected and dependent removal readiness, independently of individual eligibility', () => {
    const { data, policy, saved, first, dependency } = appPolicyFixture();
    const protection = buildPolicyProtection(data, appPolicyStore([policy]), [saved]);
    const impact = analyzeRemovalImpact(first, data.objects, data.edges, [saved], data.scan, 3, now, protection);
    expect(impact.readiness).toBe('blocked'); expect(impact.policyProtection?.conflict).toBe(true);
    expect(impact.removalPlan[0]).toMatchObject({ title: 'Resolve app retention policy protection', blocking: true });
    const dependent = analyzeRemovalImpact(dependency, data.objects, data.edges, [saved], data.scan, 3, now, protection);
    expect(dependent.protectedAffectedCount).toBe(0);
    expect(dependent.policyAffectedCount).toBe(1);
    expect(dependent.affectedObjects[0].policyProtection?.status).toBe('retained');
    expect(saved.stage).toBe('confirmed_eligible');
});
