// Public schema/runtime policy contracts; no native data or customer files.
import fs from 'node:fs';
import path from 'node:path';
import { parseReviewBaseline } from '../services/reviewEvidence';
import { potentialKnowledgeRelation } from '../services/knowledgeReferences';
import { isPotentialRelation } from '../utils/dependencySemantics';
import { knowledgeFixture } from './knowledgeFixtures';
import { fieldInvestigationFixture } from './fieldFixtures';
import { BRIEF_REASON_LIMIT, investigationBrief } from '../services/investigationBrief';
import { briefFixture } from './investigationBriefFixtures';

test('brief export schema keeps derived facts, nullable unknowns and display bounds separate from saved state', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../schemas/investigation-brief.schema.json'), 'utf8'));
    const { item, data, saved, identity, now } = briefFixture();
    const report = investigationBrief({ identity, object: item, scan: data.scan, review: saved, now });
    expect(Object.keys(report).sort()).toEqual([...schema.required].sort());
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.uncertainty.properties.summaries.maxItems).toBe(BRIEF_REASON_LIMIT);
    expect(schema.properties.known.properties.incoming.type).toContain('null');
    expect(schema.properties.decision.required).toContain('verified');
    expect(schema.properties.nextCheck.properties.action.enum).toContain(report.nextCheck.action);
    expect(schema.properties).not.toHaveProperty('evidenceBaseline');
});

test('published evidence schema and baseline parser agree on current and preserved policy versions', async () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../schemas/review-evidence.schema.json'), 'utf8'));
    const { policy } = schema.$defs.coverage.properties;
    expect(policy).toEqual({ enum: ['shared-static-v1', 'shared-static-v2', 'shared-static-v3', 'shared-static-v4', 'shared-static-v5', 'shared-static-v6', 'shared-static-v7', 'shared-static-v8', 'shared-static-v9', 'shared-static-v10'] });
    const { saved, macro } = await knowledgeFixture();
    const baseline = { ...saved.evidenceBaseline, evidence: macro.reviewEvidence };
    policy.enum.forEach((version: string) => {
        expect(parseReviewBaseline({ ...baseline, evidence: { ...baseline.evidence,
            coverage: { ...baseline.evidence?.coverage, policy: version } } })).not.toBeNull();
    });
    expect(parseReviewBaseline({ ...baseline, evidence: { ...baseline.evidence,
        coverage: { ...baseline.evidence?.coverage, policy: 'unknown-future-policy' } } })).toBeNull();
});

test('scan schema distinguishes native totals and normalized records while retaining old snapshots', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../schemas/scan-run.schema.json'), 'utf8'));
    ['collector_counts', 'collector_totals', 'collector_native_counts'].forEach(name => {
        expect(schema.properties[name]).toMatchObject({ type: 'object', additionalProperties: { type: 'integer', minimum: 0 } });
        expect(schema.required).not.toContain(name);
    });
});

test('edge schema retains inclusion, exclusion and potential forms emitted by the knowledge resolver', async () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../schemas/edge.schema.json'), 'utf8'));
    const relations: string[] = schema.properties.relation.enum;
    ['matches_event_type', 'excludes_event_type', 'matches_tag', 'excludes_tag', 'tags_event_type'].forEach(relation => {
        const potential = potentialKnowledgeRelation(relation);
        expect(relations).toContain(relation);
        expect(relations).toContain(potential);
        expect(isPotentialRelation(potential)).toBe(true);
    });
    const { data } = await knowledgeFixture();
    data.edges.forEach(edge => expect(relations).toContain(edge.relation));
});

test('field metadata schemas retain exact declared facts/provenance without raw declaration properties', async () => {
    const root = path.resolve(__dirname, '../../../../../schemas');
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'field-lineage.schema.json'), 'utf8'));
    const edge = JSON.parse(fs.readFileSync(path.join(root, 'edge.schema.json'), 'utf8'));
    expect(schema.$defs.facts.additionalProperties).toBe(false);
    expect(schema.$defs.provenance.additionalProperties).toBe(false);
    expect(schema.$defs.facts.properties).not.toHaveProperty('value');
    expect(schema.$defs.facts.properties).not.toHaveProperty('REGEX');
    expect(schema.$defs.outputDeclaration.additionalProperties).toBe(false);
    expect(schema.$defs.outputProvenance.additionalProperties).toBe(false);
    expect(schema.$defs.producerDeclaration.additionalProperties).toBe(false);
    expect(schema.$defs.facts.required).not.toContain('outputProvenance');
    expect(schema.$defs.provenance.required).not.toContain('outputDeclarations');
    const { data } = await fieldInvestigationFixture();
    data.edges.forEach(row => expect(edge.properties.relation.enum).toContain(row.relation));
    data.objects.filter(row => row.fieldLineage).forEach(row => expect(Object.keys(row.fieldLineage!)).toEqual(expect.arrayContaining(schema.$defs.facts.required)));
    data.edges.filter(row => row.fieldProvenance).forEach(row => expect(Object.keys(row.fieldProvenance!)).toEqual(expect.arrayContaining(schema.$defs.provenance.required)));
});
