// Synthetic contracts only; never imported by production code or scanned estates.
import { AppPolicyRevision, appPolicyFingerprint, appPolicyIdentity, appPolicyKey } from '../services/appPolicies';
import { configurationFingerprint } from '../services/reviewEvidence';
import { object, now, snapshot, review, edge } from './milestoneFixtures';

export function appPolicyFixture() {
    const app = { ...object(appPolicyIdentity('example'), 'App'), name: 'example', canonicalName: 'example',
        configurationFingerprint: configurationFingerprint({ label: 'Owned example' }, {
            app: 'example', owner: 'operator', sharing: 'app', perms: { read: ['user'], write: ['admin'] } }, 'apps') };
    const first = object('macro::example::first');
    const dependency = { ...object('macro::other::dependency'), app: 'other' };
    const data = snapshot([app, first, dependency], [edge(first.objectId, dependency.objectId)]);
    data.scan.collectorCounts.apps = 1; data.scan.collectorTotals.apps = 1;
    const saved = review(first.objectId, { stage: 'confirmed_eligible' });
    const policy: AppPolicyRevision = { version: 1, _key: appPolicyKey('example', 1), app_id: 'example', app_object_id: app.objectId,
        revision_number: 1, parent_revision: null, state: 'active', note: 'Retain this exact namespace',
        scope: 'shared_exact_app_current_and_future', scan_id: data.scan.scanId, app_fingerprint: appPolicyFingerprint(app)!,
        request_id: 'fixture-request', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), updated_by: 'operator' };
    return { app, first, dependency, data, saved, policy };
}
