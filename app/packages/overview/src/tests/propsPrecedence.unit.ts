// Synthetic contracts only; native runtime qualification is separate.
import { checkPropsPrecedence, PropsRead, propsReadPlan } from '../services/propsPrecedence';
import { readPropsContexts } from '../services/propsEvidence';
import { readFieldLineageFacts } from '../services/fieldLineage';
import { field } from './fieldFixtures';
import { ContentObject, DependencyEdge } from '../types';
import { attachReviewEvidence, compareReviewEvidence } from '../services/reviewEvidence';
import { now, object, review, snapshot } from './milestoneFixtures';

const original = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'exporter', 'global');
const local = field('field_aliases', 'FIELDALIAS-owner', 'actor AS local_owner', 'consumer', 'app');
const originalContent = original.entry.content as Record<string, string>;
const caller = object('caller'); caller.app = 'consumer';
const edge = (target = original.item): DependencyEdge => ({ edgeId: `edge-${target.objectId}`, sourceId: caller.objectId,
    targetId: target.objectId, relation: 'may_apply_field_alias', confidence: 'medium', resolved: true, evidence: 'Potential only', sourceLocation: 'search',
    fieldProvenance: { version: 1, kind: 'event_scope', fields: [], scope: target.fieldLineage!.scope, consumerPhase: null,
        producerPhase: 'alias', transformPositions: [], viaObjectIds: [], contextApps: ['consumer'], invocation: 'fixed_app' } });
const config = (entry = original.entry, value = (entry.content as Record<string, string>).value) => ({ entry: [{ name: (entry.content as Record<string, string>).stanza, content: {
    [(entry.content as Record<string, string>).attribute]: value, 'eai:appName': 'consumer', 'eai:userName': 'nobody' },
    // Stanza ACL is deliberately unrelated; it is NOT attribute provenance.
    acl: { app: 'unrelated', sharing: 'app', owner: 'nobody' } }] });
const native = (entry = original.entry): jest.MockedFunction<PropsRead> => jest.fn(async request => ({ status: 200,
    data: request.kind === 'rule' ? { entry: [entry] } : config(entry) }));
async function check(read: PropsRead = native(), objects: ContentObject[] = [caller, original.item], edges = [edge()], options = {}) {
    return checkPropsPrecedence(objects, edges, read, options);
}
test('cross-checks rule-level export ownership, not stanza ACL, and records inherited exact-stanza context', async () => {
    const read = native(); const result = await check(read);
    expect(result.edges[0].fieldProvenance?.propsContexts).toEqual([expect.objectContaining({ objectId: original.item.objectId,
        app: 'consumer', status: 'inherited', selectedObjectId: original.item.objectId, reason: 'matched' })]);
    expect(read.mock.calls[0][0]).toMatchObject({ app: 'consumer', kind: 'rule' });
    expect(result.edges[0]).toMatchObject({ confidence: 'medium', evidence: 'Potential only' });
    expect(JSON.stringify(result)).not.toContain('actor AS owner');
});
test('observes local override without deleting the exported fallback edge or inventing runtime execution', async () => {
    const result = await check(native(local.entry), [caller, original.item, local.item]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0]).toMatchObject({ status: 'shadowed', selectedObjectId: local.item.objectId });
    expect(result.objects.find(row => row.objectId === original.item.objectId)?.fieldLineage?.propsContexts).toEqual(expect.arrayContaining([
        expect.objectContaining({ app: 'consumer', status: 'shadowed' })]));
});
test('local binding is distinguished from inherited binding', async () => {
    const result = await check(native(local.entry), [caller, local.item], [edge(local.item)]);
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0].status).toBe('local');
});
test.each(['config_value', 'catalog_value', 'acl', 'unknown_winner', 'namespace', 'identity', 'private', 'unexported', 'duplicate'])('contradicted %s is unknown, not an effective winner', async kind => {
    const read: PropsRead = async request => {
        if (request.kind === 'merged') { const response = config();
            if (kind === 'config_value') { response.entry[0].content[originalContent.attribute] = 'changed'; }
            if (kind === 'namespace') { response.entry[0].content['eai:appName'] = 'different'; }
            if (kind === 'identity') { response.entry[0].name = 'different'; }
            return { status: 200, data: response };
        }
        const entry = JSON.parse(JSON.stringify(original.entry));
        if (kind === 'catalog_value') { entry.content.value = 'changed'; }
        if (kind === 'acl') { entry.acl.perms.read = ['different']; }
        if (kind === 'unknown_winner') { entry.acl.app = 'not_in_scan'; }
        if (kind === 'private') { entry.acl.sharing = 'user'; }
        if (kind === 'unexported') { entry.acl.sharing = 'app'; }
        return { status: 200, data: { entry: kind === 'duplicate' ? [entry, entry] : [entry] } };
    };
    const result = await check(read);
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0]).toMatchObject({ status: 'unverified', selectedObjectId: null, valueDigest: null });
});
test.each([403, 404, 500])('HTTP %s is a scoped uncertainty, never a broken-content assertion', async status => {
    const result = await check(jest.fn(async () => ({ status, data: null })));
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0].status).toBe('unverified');
    expect(result.edges[0].resolved).toBe(true);
});
test('read failures are contained and original objects and edges are immutable', async () => {
    const bytes = JSON.stringify([caller, original.item, edge()]);
    const result = await check(jest.fn(async () => { throw Error('sensitive native error'); }));
    expect(JSON.stringify(result)).not.toContain('sensitive native error');
    expect(JSON.stringify([caller, original.item, edge()])).toBe(bytes);
});
test('equal values do not replace native rule ownership with an app-name sort', async () => {
    const same = field('field_aliases', 'FIELDALIAS-owner', originalContent.value, 'z_exporter', 'global');
    const result = await check(native(), [caller, original.item, same.item]);
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0]).toMatchObject({ status: 'inherited', selectedObjectId: original.item.objectId });
});
test('request budget is shared across edges, deterministic, and cached once per native attribute/context', async () => {
    const read = native(); const result = await check(read, [caller, original.item], [edge(), { ...edge(), edgeId: 'duplicate' }], { maxContexts: 1 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.edges[0].fieldProvenance?.propsContexts).toEqual(result.edges[1].fieldProvenance?.propsContexts);
    expect(result.objects.find(row => row.objectId === original.item.objectId)?.fieldLineage?.propsContexts).toEqual(expect.arrayContaining([
        expect.objectContaining({ app: 'exporter', status: 'unverified', reason: 'budget' })]));
});
test('pattern/default scopes are not executed or assigned priority from unrelated selectors', async () => {
    const dynamic = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'exporter', 'global', 'source::*.log'); const read = native();
    const result = await check(read, [caller, dynamic.item], [edge(dynamic.item)]);
    expect(read).not.toHaveBeenCalled();
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0]).toMatchObject({ status: 'unverified', reason: 'unsupported_scope' });
});
test('cache reader rejects contradictions, duplicates, overflow and prototype keys; strips unknown properties', () => {
    const row = { version: 1, objectId: 'obj', app: 'app', status: 'local', selectedObjectId: 'obj', valueDigest: 'a'.repeat(64), reason: 'matched', value: 'never retain' };
    expect(readPropsContexts([row])?.[0]).not.toHaveProperty('value');
    expect(readPropsContexts([row, row])).toBeUndefined();
    expect(readPropsContexts(Array(257).fill(row))).toBeUndefined();
    expect(readPropsContexts([{ ...row, status: '__proto__' }])).toBeUndefined();
    expect(readPropsContexts([{ ...row, status: 'shadowed' }])).toBeUndefined();
    expect(readPropsContexts([{ ...row, status: 'unverified', reason: 'budget' }])).toBeUndefined();
});
test('wall-clock expiry aborts pending native reads and leaves queued contexts explicitly unverified', async () => {
    const read: PropsRead = request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
    });
    const result = await check(read, [caller, original.item], [edge()], { maxMilliseconds: 5 });
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0]).toMatchObject({ status: 'unverified', reason: 'budget' });
});
test.each([false, true])('parent scan cancellation propagates before/during probes (already aborted: %s)', async alreadyAborted => {
    const controller = new AbortController(); if (alreadyAborted) { controller.abort(); }
    const read: PropsRead = request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
    });
    const pending = checkPropsPrecedence([original.item], [], read, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.objects[0].fieldLineage?.propsContexts?.[0]).toMatchObject({ status: 'unverified', reason: 'budget' });
    expect(result.counts.props_context_reads).toBe(alreadyAborted ? 0 : 1);
});
test('unsupported long native app identities remain readable unknown facts rather than corrupting the cache', async () => {
    const source = field('field_aliases', 'FIELDALIAS-owner', 'actor AS owner', 'x'.repeat(201), 'global'); const read = native();
    const result = await check(read, [source.item], []);
    expect(read).not.toHaveBeenCalled();
    expect(readFieldLineageFacts(result.objects[0].fieldLineage)?.propsContexts?.[0]).toMatchObject({ status: 'unverified', reason: 'unsupported_scope' });
});
test('inherited object prototype names cannot select a native endpoint', async () => {
    const read = native(); const result = await check(read, [{ ...original.item, objectType: '__proto__' }], []);
    expect(read).not.toHaveBeenCalled(); expect(result.counts.props_context_checks).toBe(0);
});
test('calculated fields use an escaped exact REST catalog filter, not a new Web exposure or search job', () => {
    const plan = propsReadPlan({ kind: 'rule', app: 'consumer', stanza: 'literal" OR *', attribute: 'EVAL-name\\tail',
        name: 'native-name', endpoint: 'data/props/calcfields', signal: new AbortController().signal });
    expect(plan.path).toBe('data/props/calcfields'); expect(plan.query.get('count')).toBe('2');
    expect(plan.query.get('search')).toBe(String.raw`stanza="literal\" OR *" AND attribute="EVAL-name\\tail"`);
    expect(plan.query.getAll('f')).toContain('value');
});
test.each([undefined, 0, 2, '1', 1])('calculated-field filtered catalog requires exactly one authoritative result (total %s)', async total => {
    const calculated = field('calculated_fields', 'EVAL-owner', 'lower(actor)', 'exporter', 'global');
    const read: PropsRead = async request => ({ status: 200, data: request.kind === 'rule'
        ? { entry: [calculated.entry], paging: { total } } : config(calculated.entry) });
    const result = await check(read, [caller, calculated.item], [edge(calculated.item)]);
    expect(result.edges[0].fieldProvenance?.propsContexts?.[0].status).toBe(total === 1 ? 'inherited' : 'unverified');
});
test('native context changes affect object-scoped freshness even with no relationships, without rewriting a saved v6 decision', async () => {
    const data = snapshot([original.item], []);
    const scope = { scanId: data.scan.scanId, observedAt: new Date(now).toISOString(), principal: 'operator', roles: ['operator'], mode: 'full',
        collectionComplete: true, analysisComplete: true, collectors: {} };
    const first = (await checkPropsPrecedence([original.item], [], native(), { maxContexts: 0 })).objects;
    const before = (await attachReviewEvidence(first, [], scope))[0];
    const saved = review(before.objectId, { evidenceBaseline: { capturedAt: new Date(now).toISOString(), capturedBy: 'reviewer', evidence: before.reviewEvidence! } });
    const bytes = JSON.stringify(saved);
    const changed = { ...first[0], fieldLineage: { ...first[0].fieldLineage!, propsContexts: first[0].fieldLineage!.propsContexts!.map(row => ({ ...row, reason: 'access_denied' as const })) } };
    const after = (await attachReviewEvidence([changed], [], scope))[0];
    expect(after.reviewEvidence?.coverage?.outbound.digest).not.toBe(before.reviewEvidence?.coverage?.outbound.digest);
    expect(compareReviewEvidence(saved, after, data.scan, now).status).toBe('needs_review');
    expect(JSON.stringify(saved)).toBe(bytes);
});
