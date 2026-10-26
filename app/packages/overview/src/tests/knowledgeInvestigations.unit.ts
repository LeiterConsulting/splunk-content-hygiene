import { buildDependencyIndex, buildGraphModel } from '../services/dependencyGraph';
import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { compareReviewEvidence, parseReviewBaseline } from '../services/reviewEvidence';
import { isPotentialRelation } from '../utils/dependencySemantics';
import { knowledgeFixture } from './knowledgeFixtures';
import { now } from './milestoneFixtures';

test('required-content traversal retains potential tag-to-event-type context through subsequent explicit macro edges', async () => {
    const { data, saved, root, tag, event, macro } = await knowledgeFixture();
    const before = JSON.stringify(saved);
    const report = buildInUseReport(data, [saved], { selectedIds: [root.objectId], activity: 'none', includeRetained: false, successfulOnly: true }, now);
    expect(report.rows.find(row => row.objectId === tag.objectId)?.via).toMatchObject({ relation: 'excludes_tag', conditional: false });
    expect(report.rows.find(row => row.objectId === event.objectId)?.via).toMatchObject({ relation: 'may_tag_event_type', conditional: true, confidence: 'medium' });
    expect(report.rows.find(row => row.objectId === macro.objectId)?.via).toMatchObject({ relation: 'uses', conditional: true, confidence: 'medium' });
    expect(report.relationships.filter(edge => edge.relation === 'may_tag_event_type')).toHaveLength(2);
    expect(report.gaps.join(' ')).toMatch(/potential configuration/);
    expect(JSON.stringify(saved)).toBe(before);
});

test('removal impact explains exclusion broadening and preserves conditional bindings and shared follow-up protection', async () => {
    const { data, saved, root, tag, event, macro } = await knowledgeFixture();
    const direct = analyzeRemovalImpact(tag, data.objects, data.edges, [saved], data.scan, 4, now);
    expect(direct.directDependents.find(row => row.objectId === root.objectId)?.likelyOutcome).toMatch(/broaden or otherwise change/);
    expect(direct.dependencyFollowUps.filter(row => row.objectId.includes('Event Type')).every(row => !row.potentiallyOrphaned)).toBe(true);
    const transitive = analyzeRemovalImpact(macro, data.objects, data.edges, [saved], data.scan, 4, now);
    expect(transitive.affectedObjects.find(row => row.objectId === event.objectId)).toMatchObject({ conditional: false });
    expect(transitive.affectedObjects.find(row => row.objectId === root.objectId)).toMatchObject({ conditional: true, confidence: 'medium' });
    expect(transitive.readiness).toBe('blocked');
});

test('graph relationship context and JSON reports preserve the same exact identities, relations, provenance and confidence', async () => {
    const { data, saved, root, tag } = await knowledgeFixture();
    const index = buildDependencyIndex(data.objects, data.edges);
    const adjacent = [...(index.inbound.get(tag.objectId) ?? []), ...(index.outbound.get(tag.objectId) ?? [])];
    const graph = buildGraphModel(tag.objectId, index, adjacent, { grouping: 'type', expandedGroups: new Map(), expandedNodes: new Set() });
    const rendered = graph.links.flatMap(link => link.edges).map(edge => edge.edgeId).sort();
    expect(rendered).toEqual(adjacent.map(edge => edge.edgeId).sort());
    const report = buildInUseReport(data, [saved], { selectedIds: [root.objectId], activity: 'none', includeRetained: false, successfulOnly: true }, now);
    const exported = JSON.parse(JSON.stringify(report));
    expect(exported.relationships.some((edge: { relation: string }) => edge.relation === 'excludes_tag')).toBe(true);
    expect(exported.relationships.filter((edge: { relation: string }) => isPotentialRelation(edge.relation)).every((edge: { sourceLocation: string; confidence: string }) =>
        edge.sourceLocation.includes('tags.conf') && edge.confidence === 'medium')).toBe(true);
});

test.each(['may_exclude_tag', 'may_exclude_event_type'])('potential exclusion impact retains broadening semantics: %s', async relation => {
    const { data, saved, root, tag } = await knowledgeFixture();
    const edges = data.edges.map(edge => edge.sourceId === root.objectId && edge.targetId === tag.objectId ? { ...edge, relation } : edge);
    const report = analyzeRemovalImpact(tag, data.objects, edges, [saved], data.scan, 4, now);
    const affected = report.directDependents.find(row => row.objectId === root.objectId);
    expect(affected).toMatchObject({ relation, conditional: true });
    expect(affected?.likelyOutcome).toMatch(/Potential impact only.*may exclude.*If the binding applies at runtime.*broaden or otherwise change/);
    expect(affected?.likelyOutcome).toContain('does not make the object unnecessary');
    expect(report.readiness).toBe('blocked');
});

test.each(['may_match_tag', 'may_match_event_type'])('potential inclusion impact does not reuse exclusion guidance: %s', async relation => {
    const { data, saved, root, tag } = await knowledgeFixture();
    const edges = data.edges.map(edge => edge.sourceId === root.objectId && edge.targetId === tag.objectId ? { ...edge, relation } : edge);
    const report = analyzeRemovalImpact(tag, data.objects, edges, [saved], data.scan, 4, now);
    const affected = report.directDependents.find(row => row.objectId === root.objectId);
    expect(affected).toMatchObject({ relation, conditional: true });
    expect(affected?.likelyOutcome).toMatch(/may select.*If the binding applies at runtime.*narrow or otherwise change/);
    expect(affected?.likelyOutcome).not.toContain('broaden');
});

test('coverage-policy expansion never silently rewrites or reaffirms a retained Library decision', async () => {
    const { data, saved, macro } = await knowledgeFixture();
    const before = JSON.stringify(saved);
    expect(parseReviewBaseline(saved.evidenceBaseline)).not.toBeNull();
    expect(parseReviewBaseline({ ...saved.evidenceBaseline, evidence: macro.reviewEvidence })).not.toBeNull();
    expect(compareReviewEvidence(saved, macro, data.scan, now)).toMatchObject({ status: 'needs_review',
        reasons: expect.arrayContaining([expect.stringContaining('coverage policy expanded')]) });
    expect(JSON.stringify(saved)).toBe(before);
    expect(saved).toMatchObject({ stage: 'retain', note: 'Original rationale', assignedTo: 'original-team', revisionId: 'revision-1' });
});
