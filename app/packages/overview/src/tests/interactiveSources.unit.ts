/* eslint-disable no-script-url -- Adversarial URI fixture, never rendered or executed. */
// Synthetic syntax contracts, never imported by production or seeded into labs.
import { INTERACTION_REFERENCE_LIMIT, NAVIGATION_NODE_LIMIT, parseInternalLink, parseNavigation, parseWorkflowAction } from '../services/interactiveSources';

const action = (content: Record<string, unknown>) => parseWorkflowAction(JSON.stringify({ type: 'search', label: 'Investigate', disabled: 'false', ...content }));
const targets = (value: ReturnType<typeof parseNavigation>) => value.references.map(row => [row.targetType, row.targetName, row.contextApp, row.exactNamespace]);

test('navigation preserves literal local view/report case, positions and exact namespaces', () => {
    const result = parseNavigation('<nav search_view="Search"><view name="Overview"/><collection label="Reports"><saved name="Weekly Report" view="ReportView"/></collection></nav>', 'Example');
    expect(targets(result)).toEqual([
        ['dashboard', 'Search', 'Example', true], ['dashboard', 'Overview', 'Example', true],
        ['saved_search', 'Weekly Report', 'Example', true], ['dashboard', 'ReportView', 'Example', true],
    ]);
    expect(result.references[2]).toMatchObject({ relation: 'links_to_report', sourceLocation: 'eai:data.nav.collection[2].saved[1]@name', absenceUnverified: true });
    expect(result.warnings).toEqual([]);
});

test('literal same-origin routes name exact app and view without reading query bodies', () => {
    const uri = '/en-US/app/OtherApp/Long%20View?form.token=$value$&q=secret-query#fragment';
    const parsed = parseInternalLink(uri);
    expect(targets(parsed)).toEqual([['app', 'OtherApp', 'OtherApp', true], ['dashboard', 'Long View', 'OtherApp', true]]);
    expect(parsed.references.every(row => row.absenceUnverified)).toBe(true);
    expect(parsed.warnings.join(' ')).toMatch(/query\/fragment/);
    expect(JSON.stringify(parsed)).not.toMatch(/secret-query|\$value\$|#fragment/);
});

test.each([
    'https://outside.example/app/example/view', '//outside.example/app/example/view',
    'javascript:alert(1)', 'data:text/html,anything', 'view', '../view', '/app/$namespace$/view',
    '/app/example/$view$', '/app/example/a%2Fb', '/app/example/%252e%252e', '/app/example/%2e%2e',
    '/app/example/%5csecret', '/app/example/%00', '/app/example/bad%ZZ', '/app/example/view/extra',
    '/app/./view', '/app/../view', '/app/example/view\n', '/app/example/view path', '/app/example/%24token%24',
])('unsupported route never invents a target: %s', uri => {
    const result = parseInternalLink(uri);
    expect(result.references).toEqual([]); expect(result.gaps?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(uri));
});

test('app-only route does not fabricate a default view', () => {
    expect(targets(parseInternalLink('/app/Example'))).toEqual([['app', 'Example', 'Example', true]]);
    expect(parseInternalLink('/app/Example').gaps?.[0]).toMatchObject({ targets: ['dashboard'], contextApp: 'Example' });
});

test.each([
    '<view source="all"/>', '<saved source="unclassified" match="top"/>', '<view name="x" source="all"/>',
    '<view name="$runtime$"/>', '<view name="x" app="other"/>', '<view name="x" namespace="other"/>',
    '<saved name=" wildcard* "/>', '<custom><view name="not-a-menu"/></custom>',
])('dynamic/custom menu does not fabricate a static named reference: %s', body => {
    const result = parseNavigation(`<nav>${body}</nav>`, 'example');
    expect(result.references).toEqual([]); expect(result.gaps?.length).toBeGreaterThan(0);
});

test.each([
    '<nav><view name="broken"></nav>', '<dashboard><view name="x"/></dashboard>',
    '<nav xmlns="https://outside.example/schema"><view name="x"/></nav>',
    '<!DOCTYPE nav [<!ENTITY remote SYSTEM "https://outside.example/value">]><nav><view name="&remote;"/></nav>',
    '<!DOCTYPE nav><nav><view name="x"/></nav>',
])('malformed/foreign/DTD XML is rejected before deriving dependencies', text => {
    expect(parseNavigation(text, 'example').references).toEqual([]);
    expect(parseNavigation(text, 'example').gaps?.length).toBeGreaterThan(0);
});

test('XML entities are decoded only by the inert XML parser; default and modern icons do not invent extra edges', () => {
    const result = parseNavigation('<nav color="#000000"><view name="Case &amp; Exact" default="true" icon="House"/><divider/></nav>', 'example');
    expect(targets(result)).toEqual([['dashboard', 'Case & Exact', 'example', true]]);
    expect(result.references[0].evidence).not.toMatch(/observed activity is established/);
});

test('navigation link parameters cannot be mistaken for inline searches or report targets', () => {
    const result = parseNavigation('<nav><a href="/app/other/View?q=%7C%20savedsearch%20hidden&amp;form.x=$token$">Explore</a></nav>', 'example');
    expect(result.references.map(row => row.targetType)).toEqual(['app', 'dashboard']);
    expect(JSON.stringify(result)).not.toMatch(/hidden|\$token\$|%7C/);
});

test('navigation bounds duplicate references, inspected nodes and unsupported nesting', () => {
    const repeated = parseNavigation(`<nav>${'<view name="same"/>'.repeat(INTERACTION_REFERENCE_LIMIT + 10)}</nav>`, 'example');
    expect(repeated.references).toHaveLength(INTERACTION_REFERENCE_LIMIT);
    expect(repeated.warnings.join(' ')).toMatch(/budget/);
    const nodes = parseNavigation(`<nav>${'<divider/>'.repeat(NAVIGATION_NODE_LIMIT + 10)}<view name="late"/></nav>`, 'example');
    expect(nodes.references).toEqual([]); expect(nodes.warnings.join(' ')).toMatch(/budget/);
    const depth = parseNavigation('<nav><collection><collection><collection><view name="too-deep"/></collection></collection></collection></nav>', 'example');
    expect(depth.references).toEqual([]); expect(depth.warnings.join(' ')).toMatch(/nesting/);
});

test('workflow search with explicit app preserves static references without inferring implicit props callers', () => {
    const result = action({ 'search.app': 'Target', 'search.view': 'SearchView', 'search.search_string': '| savedsearch "Named Report" | inputlookup catalog.csv' });
    expect(result.references).toEqual(expect.arrayContaining([
        expect.objectContaining({ targetType: 'app', targetName: 'Target', exactNamespace: true, contextApp: 'Target' }),
        expect.objectContaining({ targetType: 'dashboard', targetName: 'SearchView', exactNamespace: true, contextApp: 'Target' }),
        expect.objectContaining({ targetType: 'saved_search', targetName: 'Named Report', contextApp: 'Target' }),
        expect.objectContaining({ targetType: 'lookup_file', targetName: 'catalog.csv', contextApp: 'Target' }),
    ]));
    expect(result.hasEventSearch).toBeUndefined(); expect(result.eventSelectors).toBeUndefined();
    expect(result.warnings.join(' ')).toMatch(/not event-menu applicability/);
});

test('runtime-inherited search namespace cannot be silently resolved against its owning app', () => {
    const result = action({ 'search.search_string': 'index=main `base` | savedsearch "Report"' });
    expect(result.references.filter(row => row.targetType !== 'index').every(row => row.resolutionUncertain)).toBe(true);
    expect(result.references.find(row => row.targetType === 'index')?.resolutionUncertain).toBe(false);
    expect(result.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ invocationNamespaceUnverified: true })]));
    expect(result.warnings.join(' ')).toMatch(/owning app is not assumed/);
});

test.each(['$field$', '| savedsearch Literal $field$', '| inputlookup before | eval x="$field$"'])('field templates are not partially interpreted as executable SPL', search => {
    const result = action({ 'search.app': 'example', 'search.search_string': search });
    expect(result.references.map(row => row.targetType)).toEqual(['app']);
    expect(result.warnings.join(' ')).toMatch(/runtime field tokens/);
    expect(JSON.stringify(result)).not.toContain('$field$');
});

test('GET workflow links retain the exact fixed path, never POST execution or URL contents', () => {
    const get = action({ type: 'link', 'link.uri': '/app/other/Target?secret=not-retained' });
    expect(targets(get)).toEqual([['app', 'other', 'other', true], ['dashboard', 'Target', 'other', true]]);
    expect(JSON.stringify(get)).not.toContain('not-retained');
    const post = action({ type: 'link', 'link.method': 'post', 'link.uri': '/app/other/Target' });
    expect(post.references).toEqual([]); expect(post.warnings.join(' ')).toMatch(/no request is sent/);
});

test.each([{}, { type: 'custom' }, { label: '' }, { type: null }])('missing native required action metadata stays unverified', override => {
    const content = Object.keys(override).length ? { type: 'search', label: 'Action', 'search.app': 'example', ...override } : {};
    const result = parseWorkflowAction(JSON.stringify(content));
    expect(result.references).toEqual([]); expect(result.gaps?.length).toBeGreaterThan(0);
});

test.each(['True', true, 'unsupported', undefined])('disabled/unknown action does not establish current activity', disabled => {
    expect(action({ disabled, type: 'link', 'link.uri': '/app/example/View' }).warnings.join(' ')).toMatch(/disabled or its enabled state is unknown/);
});

test('large interaction sources stop before parsing', () => {
    const source = 'x'.repeat(1024 * 1024 + 1);
    expect(parseNavigation(source, 'example').references).toEqual([]);
    expect(parseWorkflowAction(source).references).toEqual([]);
});
