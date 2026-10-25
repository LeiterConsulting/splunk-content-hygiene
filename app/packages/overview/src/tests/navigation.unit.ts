import { readQueryParam, readQueryParams, serializeQuery, viewPath } from '../utils/navigation';

test.each([
    'saved_search::example::Weekly Report',
    'saved_search::example::A+B',
    'saved_search::example::A + B & 95% / café #weekly',
    'macro::same app::Nested::identity',
])('native-host links preserve exact identity across reloads: %s', (object) => {
    const link = viewPath('dependencies', { object, scan: 'scan-current' });
    expect(link).not.toContain('+');
    // The observed native host turns a raw '+' into a literal plus during
    // navigation. No raw plus remains for that boundary to misinterpret.
    const query = link.slice(link.indexOf('?')).replace(/\+/g, '%2B');
    expect(readQueryParams(query).get('object')).toBe(object);
    expect(serializeQuery(readQueryParams(query))).not.toContain('+');
});

test('spaces and literal plus identities cannot collapse onto the same link', () => {
    expect(viewPath('dependencies', { object: 'saved_search::a::A B' })).toContain('A%20B');
    expect(viewPath('dependencies', { object: 'saved_search::a::A+B' })).toContain('A%2BB');
});

test('form-style incoming spaces are decoded once without changing encoded literal plus or percent', () => {
    window.history.replaceState(null, '', '/?object=A+B%2BC%2520D');
    expect(readQueryParam('object')).toBe('A B+C%20D');
    expect(readQueryParam('missing')).toBe('');
});
