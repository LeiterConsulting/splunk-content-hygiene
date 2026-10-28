// Adversarial declaration contracts only; no native configuration is created.
import { comparePropsDomains, PROPS_DOMAIN_PAIR_STATES } from '../services/propsDomains';
import { declaredFieldScope, readFieldProvenance } from '../services/fieldLineage';
import { analyzeInventory } from '../services/analysis';
import { buildFieldDependencyMatcher, FIELD_SOURCE_VISIT_LIMIT } from '../services/fieldDependencies';
import { FieldScope } from '../types';
import { field, fieldCompleteness } from './fieldFixtures';

const scope = (value: string): FieldScope => declaredFieldScope(value);
const compare = (a: string, b: string) => comparePropsDomains(scope(a), scope(b));
test.each([
    ['app:events', 'app:events', 'same_literal'], ['app:events', 'APP:EVENTS', 'disjoint'],
    ['host::Server', 'host::SERVER', 'same_literal'], ['source::/var/A', 'source::/var/a', 'disjoint'],
    ['app:*', 'app:events', 'bounded_intersection'], ['app:*', 'APP:events', 'disjoint'],
    ['app:*prod', 'app:web*', 'bounded_intersection'], ['app:*prod', 'other:*', 'disjoint'],
    ['source::/var/*.log', 'source::/var/a/b.log', 'disjoint'],
    ['source::/var/...', 'source::/var/a/b.log', 'bounded_intersection'],
    ['source::/var/*.log', 'source::/var/a*.log', 'bounded_intersection'],
    ['source::/var/*.log', 'source::/var/*/b.log', 'disjoint'],
    ['source::.../a', 'source::b/...', 'bounded_intersection'],
    ['source::*a', 'source::*b', 'disjoint'], ['host::A*', 'host::*a', 'bounded_intersection'],
    ['default', 'app:*', 'captured_default'], ['source::/var/log/a', 'default', 'captured_default'],
    ['default', 'default', 'captured_default'], ['host::default', 'host::other', 'disjoint'],
    ['source::x', 'host::x', 'different_field'], ['app:*', 'host::app:*', 'different_field'],
    ['(?i)app:*', 'app:x', 'unsupported'], ['source::C:\\logs\\*', 'default', 'unsupported'],
    ['source::/caf\u00e9/...', 'default', 'unsupported'], ['app:%41*', 'app:A', 'unsupported'],
])('strict domain compatibility %s / %s = %s', (a, b, expected) => {
    expect(compare(a, b)).toBe(expected); expect(compare(b, a)).toBe(expected);
});

test('bounded product states agree with an independent small finite-language enumerator', () => {
    const patterns = ['*', '...', 'a*', '*b', 'a*b', '.../a', 'a/...', 'a*...b', '*/*', 'a.b', 'a...b', 'b*a'];
    const accepts = (pattern: string, value: string): boolean => {
        const tokens = pattern.match(/\.\.\.|./g) ?? [];
        const walk = (i: number, j: number): boolean => {
            if (i === tokens.length) { return j === value.length; }
            const token = tokens[i];
            if (token === '*' || token === '...') {
                if (walk(i + 1, j)) { return true; }
                return j < value.length && (token === '...' || !'/\\'.includes(value[j])) && walk(i, j + 1);
            }
            return value[j] === token && walk(i + 1, j + 1);
        };
        return walk(0, 0);
    };
    let values = ['']; const all: string[] = [];
    for (let length = 1; length <= 5; length += 1) { values = values.flatMap(value => ['a', 'b', '/', '.'].map(c => value + c)); all.push(...values); }
    patterns.forEach(a => patterns.forEach(b => {
        const witness = all.some(value => accepts(a, value) && accepts(b, value));
        const result = compare(`source::${a}`, `source::${b}`);
        if (witness) { expect(['same_literal', 'bounded_intersection']).toContain(result); }
        else { expect(result).toBe('disjoint'); }
    }));
});

test('all product-state work is bounded and exhaustion is not disjointness', () => {
    const shared = { remaining: 1 }; const own = { remaining: 1000 };
    expect(comparePropsDomains(scope('a*...b'), scope('a...*b'), [shared, own])).toBe('budget');
    expect(shared.remaining).toBe(0); expect(own.remaining).toBe(999);
    expect(PROPS_DOMAIN_PAIR_STATES).toBe(65536);
    expect(comparePropsDomains(scope('a*'), scope(`a${'b'.repeat(1024)}`))).toBe('budget');
});

test.each(['example:*', 'default'])('declared producers and consumers join supported %s domains with both scopes', stanza => {
    const producer = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', stanza);
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const result = analyzeInventory([producer.item, consumer.item], [producer.source, consumer.source], fieldCompleteness);
    expect(result.edges).toHaveLength(1);
    const proof = result.edges[0].fieldProvenance!;
    expect(proof.scopeCompatibility).toEqual({ version: 1, consumer: consumer.item.fieldLineage!.scope,
        producer: producer.item.fieldLineage!.scope, basis: stanza === 'default' ? 'captured_default' : 'bounded_intersection' });
    expect(readFieldProvenance(proof)).toEqual(proof);
    expect(readFieldProvenance({ ...proof, scopeCompatibility: { ...proof.scopeCompatibility, basis: 'same_literal' } })).toBeUndefined();
    expect(readFieldProvenance({ ...proof, scopeCompatibility: { ...proof.scopeCompatibility, producer: null } })).toBeUndefined();
    expect(result.edges[0].evidence).toContain('not observed events');
    expect(result.coverageGaps.length).toBeGreaterThan(0);
});

test('pattern REPORT producers preserve exact transform output attribution, defaults and phase restrictions', () => {
    const transform = field('field_transforms', 'actor', 'actor::$1');
    const report = field('field_extractions', 'REPORT-actor', 'actor', 'example', 'app', 'example:*');
    const alias = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'example', 'app', 'default');
    const aliasChain = field('field_aliases', 'FIELDALIAS-chain', 'principal AS chained');
    const calc = field('calculated_fields', 'EVAL-user', 'principal', 'example', 'app', 'example:e*');
    const calcChain = field('calculated_fields', 'EVAL-chain', 'user');
    const rows = [transform, report, alias, aliasChain, calc, calcChain];
    const result = analyzeInventory(rows.map(row => row.item), rows.map(row => row.source), fieldCompleteness);
    expect(result.edges.find(row => row.sourceId === alias.item.objectId)).toMatchObject({ targetId: report.item.objectId,
        fieldProvenance: { viaObjectIds: [transform.item.objectId], scopeCompatibility: { basis: 'captured_default' },
            outputDeclarations: [expect.objectContaining({ objectId: transform.item.objectId, field: 'actor', attribute: 'FORMAT' })] } });
    expect(result.edges.some(row => row.sourceId === aliasChain.item.objectId)).toBe(false);
    expect(result.edges.some(row => row.sourceId === calcChain.item.objectId)).toBe(false);
});

test('a private/local pattern shadow suppresses ghost producer outputs without exporting private identity', () => {
    const producer = field('field_aliases', 'FIELDALIAS-user', 'actor AS principal', 'definitions', 'global', 'example:*');
    const local = field('field_aliases', 'FIELDALIAS-user', 'other AS different', 'example', 'app', 'example:*');
    const consumer = field('calculated_fields', 'EVAL-user', 'principal');
    const run = (rows: typeof producer[], privateName = false) => analyzeInventory(rows.map(row => row.item), rows.map(row => row.source), fieldCompleteness,
        undefined, privateName ? { privateObjects: [{ collector: 'field_aliases', app: 'example', count: 1 }],
            privateTargets: [{ collector: 'field_aliases', app: 'example', name: producer.item.canonicalName }] } : undefined);
    expect(run([producer, local, consumer]).edges).toEqual([]);
    expect(run([producer, consumer], true).edges).toEqual([]);
});

test('nonmatching pattern candidates consume bounded visits; exact lookups avoid unrelated scope buckets', () => {
    const producers = Array.from({ length: FIELD_SOURCE_VISIT_LIMIT + 5 }, (_v, i) => field('field_aliases', `FIELDALIAS-${i}`, 'actor AS principal', 'example', 'app', `other:${i}`));
    const consumer = field('calculated_fields', 'EVAL-user', 'principal', 'example', 'app', 'example:*');
    const matcher = buildFieldDependencyMatcher(producers.map(row => row.item), true);
    const result = matcher(consumer.item, { references: [], warnings: [], fieldLineage: consumer.item.fieldLineage });
    expect(result.references).toEqual([]); expect(result.warnings).toContainEqual(expect.stringContaining('candidate inspection reached'));
    const exact = field('calculated_fields', 'EVAL-exact', 'principal');
    const direct = matcher(exact.item, { references: [], warnings: [], fieldLineage: exact.item.fieldLineage });
    expect(direct.references).toEqual([]); expect(direct.warnings.some(message => /candidate inspection/.test(message))).toBe(false);
});
