// Synthetic summary contracts only. Never bundled or inserted into a lab.
import { ContentObject, EvidenceCoverageDimension } from '../types';
import { configurationFingerprint, evidenceDigest } from '../services/reviewEvidence';
import { object, review, snapshot, now, usage } from './milestoneFixtures';

export function briefFixture(type = 'Macro', id = 'subject') {
    const item = object(id, type);
    item.configurationFingerprint = configurationFingerprint({ definition: 'fixture' }, {
        app: item.app, owner: item.owner, sharing: item.sharing, perms: { read: ['user'], write: ['admin'] },
    });
    const dimension = (): EvidenceCoverageDimension => ({ status: 'complete', reasons: [], sourceCount: 1, sourceObjectIds: [item.objectId], digest: evidenceDigest([]) });
    item.reviewEvidence = {
        version: 2, objectId: item.objectId, objectType: item.objectType, scanId: item.inventoryScanId!, observedAt: new Date(now).toISOString(),
        configuration: item.configurationFingerprint, owner: item.owner, sharing: item.sharing, enabled: true, scheduled: false, protected: false,
        relationshipDigest: evidenceDigest([]), relationshipCount: 0, relationships: [], relationshipsTruncated: false,
        scopeDigest: evidenceDigest('fixture'), coverageComplete: true, limitations: [],
        coverage: { policy: 'shared-static-v10', configuration: dimension(), access: dimension(), inbound: dimension(), outbound: dimension() },
    };
    if (type === 'Report') { item.usageEvidence = usage(); }
    const data = snapshot([item]);
    const saved = review(item.objectId, { objectType: item.objectType, stage: 'confirmed_eligible', evidenceBaseline: {
        capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: JSON.parse(JSON.stringify(item.reviewEvidence)), usageAtCapture: item.usageEvidence,
    } });
    return { item, data, saved, now, identity: identity(item) };
}
export const identity = (item: ContentObject) => ({ objectId: item.objectId, name: item.name, objectType: item.objectType, app: item.app });
