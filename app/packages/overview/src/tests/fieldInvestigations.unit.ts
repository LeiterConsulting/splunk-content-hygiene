import { buildInUseReport } from '../services/inUseContent';
import { analyzeRemovalImpact } from '../services/removalImpact';
import { buildDependencyIndex, buildGraphModel } from '../services/dependencyGraph';
import { compareReviewEvidence, parseReviewBaseline } from '../services/reviewEvidence';
import { isPotentialRelation } from '../utils/dependencySemantics';
import { fieldInvestigationFixture } from './fieldFixtures';
import { now } from './milestoneFixtures';

test('field provenance survives the exact graph, conditional required-content chain and JSON round-trip', async () => {
    const { data, calculated, alias, extraction, transform } = await fieldInvestigationFixture();
    const report = buildInUseReport(data, [], { selectedIds: [calculated.objectId], activity: 'none', includeRetained: false, successfulOnly: true }, now);
    expect(report.rows).toHaveLength(4);
    expect(report.rows.find(row => row.objectId === alias.objectId)?.via).toMatchObject({ depth: 1, conditional: true, confidence: 'medium',
        fieldProvenance: { fields: ['principal'], consumerPhase: 'calculated', producerPhase: 'alias' } });
    expect(report.rows.find(row => row.objectId === extraction.objectId)?.via).toMatchObject({ depth: 2, conditional: true, confidence: 'medium',
        fieldProvenance: { fields: ['actor'], viaObjectIds: [transform.objectId] } });
    expect(report.rows.find(row => row.objectId === transform.objectId)?.via).toMatchObject({ depth: 3, conditional: true, confidence: 'medium',
        fieldProvenance: { transformPositions: [1, 2] } });
    const exported = JSON.parse(JSON.stringify(report));
    expect(exported.relationships.every((edge: { relation: string }) => isPotentialRelation(edge.relation))).toBe(true);
    expect(exported.rows.find((row: { objectId: string }) => row.objectId === calculated.objectId).fieldLineage).toEqual(calculated.fieldLineage);
    const index = buildDependencyIndex(data.objects, data.edges);
    const adjacent = [...(index.inbound.get(extraction.objectId) ?? []), ...(index.outbound.get(extraction.objectId) ?? [])];
    const graph = buildGraphModel(extraction.objectId, index, adjacent, { grouping: 'type', expandedGroups: new Map(), expandedNodes: new Set() });
    expect(graph.links.flatMap(link => link.edges).map(edge => edge.edgeId).sort()).toEqual(adjacent.map(edge => edge.edgeId).sort());
    expect(graph.links.flatMap(link => link.edges).some(edge => edge.fieldProvenance?.transformPositions.length === 2)).toBe(true);
});

test('removal analysis propagates potential field impact without field-availability or deletion approval', async () => {
    const { data, calculated, extraction, transform } = await fieldInvestigationFixture();
    const report = analyzeRemovalImpact(transform, data.objects, data.edges, [], data.scan, 5, now);
    expect(report.directDependents.find(row => row.objectId === extraction.objectId)).toMatchObject({ conditional: true, confidence: 'medium',
        fieldProvenance: { transformPositions: [1, 2] }, likelyOutcome: expect.stringContaining('ordered REPORT') });
    expect(report.affectedObjects.find(row => row.objectId === calculated.objectId)).toMatchObject({ conditional: true, confidence: 'medium', depth: 3,
        fieldLineage: { operation: 'eval' }, fieldProvenance: { fields: ['principal'] } });
    expect(report.readiness).toBe('blocked');
    expect(JSON.stringify(report)).toContain('not proof');
});

test.each(['shared-static-v1', 'shared-static-v2', 'shared-static-v3', 'shared-static-v4', 'shared-static-v5', 'shared-static-v6'] as const)('field coverage expansion reads %s without rewriting a saved decision', async policy => {
    const { data, calculated, saved } = await fieldInvestigationFixture();
    saved.evidenceBaseline!.evidence.coverage!.policy = policy;
    const original = JSON.stringify(saved);
    expect(parseReviewBaseline(saved.evidenceBaseline)).not.toBeNull();
    expect(calculated.reviewEvidence?.coverage?.policy).toBe('shared-static-v8');
    expect(compareReviewEvidence(saved, calculated, data.scan, now)).toMatchObject({ status: 'needs_review',
        reasons: expect.arrayContaining([expect.stringContaining('coverage policy expanded')]) });
    expect(JSON.stringify(saved)).toBe(original);
    expect(saved).toMatchObject({ stage: 'retain', note: 'Original rationale', assignedTo: 'original-team', revisionId: 'revision-1' });
});

test.each(['inline', 'named_transform'] as const)('%s declarations survive graph, required-content, impact and JSON without upgrading potential evidence', async mode => {
    const { data, calculated, alias, extraction, transform } = await fieldInvestigationFixture(mode);
    const origin = mode === 'inline' ? extraction : transform;
    const edge = data.edges.find(row => row.sourceId === alias.objectId && row.targetId === extraction.objectId)!;
    const declarations = edge.fieldProvenance!.outputDeclarations!;
    expect(declarations).toMatchObject([{ field: 'actor', capture: 1, offset: 0, objectId: origin.objectId,
        method: mode === 'inline' ? 'inline_named_captures' : 'transform_named_captures' }]);
    const footprint = buildInUseReport(data, [], { selectedIds: [calculated.objectId], activity: 'none', includeRetained: false, successfulOnly: true }, now);
    expect(footprint.rows.find(row => row.objectId === extraction.objectId)?.via).toMatchObject({ conditional: true, confidence: 'medium',
        fieldProvenance: { outputDeclarations: declarations } });
    const impact = analyzeRemovalImpact(origin, data.objects, data.edges, [], data.scan, 5, now);
    const affected = impact.affectedObjects.find(row => row.objectId === alias.objectId)!;
    expect(affected).toMatchObject({ conditional: true, confidence: 'medium', fieldProvenance: { outputDeclarations: declarations } });
    expect(impact.readiness).toBe('blocked');
    const index = buildDependencyIndex(data.objects, data.edges);
    const adjacent = [...(index.inbound.get(extraction.objectId) ?? []), ...(index.outbound.get(extraction.objectId) ?? [])];
    const graph = buildGraphModel(extraction.objectId, index, adjacent, { grouping: 'type', expandedGroups: new Map(), expandedNodes: new Set() });
    expect(graph.links.flatMap(link => link.edges).find(row => row.edgeId === edge.edgeId)?.fieldProvenance?.outputDeclarations).toEqual(declarations);
    expect(JSON.parse(JSON.stringify(footprint)).relationships.find((row: { edgeId: string }) => row.edgeId === edge.edgeId).fieldProvenance.outputDeclarations).toEqual(declarations);
    expect(JSON.stringify({ footprint, impact, graph })).not.toContain('synthetic-pattern');
});
