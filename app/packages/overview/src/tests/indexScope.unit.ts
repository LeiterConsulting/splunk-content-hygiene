import { parseSpl, parseDataModel } from '../services/dependencyParser';

test.each([
    ['index=main', true],
    ['(index=main OR index=_audit)', true],
    ['index=main NOT (index=retired OR index=old)', true],
    ['index=main OR sourcetype=events', false],
    ['NOT NOT (index=main)', true],
    ['NOT index=main', false],
    ['index IN (main,_audit)', true],
    ['index IN (main,_audit) OR error', false],
    ['[search error index=_audit] index=main', true],
    ['[search error] index=main', false],
    ['| makeresults | append [ | inputlookup hosts.csv ]', true],
    ['| makeresults | append [search error]', false],
    ['| tstats count WHERE index=main OR index=_audit', true],
    ['| tstats count by index', false],
    ['| tstats count FROM datamodel=Model.Events', true],
    ['"index=main"', false],
    ['| inputlookup hosts.csv', true],
] as const)('index scope is branch-aware for %s', (query, bounded) => {
    const result = parseSpl(query);
    const implicit = result.gaps?.some((gap) => gap.message.includes('Implicit/default index'));
    expect(implicit).toBe(!bounded);
});

test('child data-model filters inherit the root index constraint instead of becoming independent default-index searches', () => {
    const parsed = parseDataModel(JSON.stringify({ objects: [
        { objectName: 'Root', parentName: 'BaseEvent', constraints: [{ search: 'index=main' }], calculations: [] },
        { objectName: 'Child', parentName: 'Root', constraints: [{ search: 'status=error' }], calculations: [] },
    ] }));
    expect(parsed.warnings).toEqual([]);
    const unbounded = parseDataModel(JSON.stringify({ objects: [
        { objectName: 'Root', parentName: 'BaseEvent', constraints: [{ search: 'tag=events' }], calculations: [] },
    ] }));
    expect(unbounded.gaps?.some((gap) => gap.targets !== 'all' && gap.targets.includes('index'))).toBe(true);
});
