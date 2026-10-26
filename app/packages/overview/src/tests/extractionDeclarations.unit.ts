import { EXTRACTION_CAPTURE_LIMIT, EXTRACTION_GROUP_DEPTH, EXTRACTION_PATTERN_BYTES,
    inlineExtractionDeclarations, namedCaptureDeclarations } from '../services/extractionDeclarations';

test.each(['(?<actor>[^ ]+)', '(?P<actor>[^ ]+)', "(?'actor'[^ ]+)"])(
    'recognizes literal capture declarations without evaluating the pattern: %s', pattern => {
        expect(inlineExtractionDeclarations(pattern)).toMatchObject({ captures: [{ field: 'actor', group: 1, offset: 0 }], groupCount: 1,
            complete: true, sourceField: '_raw', sourceOrigin: 'default_raw' });
    });
test('capture indexes include unnamed groups; offsets retain native declaration positions', () => {
    const value = '^prefix (one)(?:two)(?<actor>three)(?P<result>four)$';
    expect(namedCaptureDeclarations(value)).toEqual({ captures: [
        { field: 'actor', group: 2, offset: value.indexOf('(?<actor>') },
        { field: 'result', group: 3, offset: value.indexOf('(?P<result>') }], groupCount: 3, complete: true, reason: null });
});
test.each([
    '\\Q(?<fake>text)\\E(?<real>.+)',
    '\\(\\?<fake>text\\)(?<real>.+)',
    '[()?#<>fake]+(?<real>.+)',
    '[[:alpha:]()]+(?<real>.+)',
    '[\\Q](?<fake>\\E]+(?<real>.+)',
    '(?# literal (?<fake> )(?:text)(?<real>.+)',
    '(?x)# (?<fake>comment)\n(?<real>.+)',
    '(?x:[#](?:text)# (?<fake>comment)\n)(?<real>.+)',
])('fake capture text in literals/classes/comments does not become a field: %s', pattern => {
    const result = namedCaptureDeclarations(pattern);
    expect(result.complete).toBe(true); expect(result.captures.map(row => row.field)).toEqual(['real']);
});
test('scoped extended mode restores its parent; escaped hash is not a comment', () => {
    expect(namedCaptureDeclarations('(?x: text # (?<fake>comment)\n)(?-x:#)(?<real>.+)\\#')).toMatchObject({ complete: true, captures: [{ field: 'real' }] });
});
test('literal explicit input fields do not become output names or same-phase dependencies', () => {
    expect(inlineExtractionDeclarations('(?<actor>.+) in payload')).toMatchObject({ complete: true, sourceField: 'payload', sourceOrigin: 'explicit_inline', captures: [{ field: 'actor' }] });
    expect(inlineExtractionDeclarations('literal in text (?<actor>.+) in payload')).toMatchObject({ complete: true, sourceField: 'payload' });
    expect(inlineExtractionDeclarations('literal in (?<actor>.+)$')).toMatchObject({ complete: true, sourceField: '_raw' });
});
test.each(['(?<actor>.+) in $runtime$', '(?<actor>.+) in field.name', '(?<actor>.+) in'])('ambiguous source clauses are not guessed: %s', pattern => {
    expect(inlineExtractionDeclarations(pattern).complete).toBe(false);
});
test.each(['(?<broken', '(?<actor>.+', '(?<actor>[unterminated)', '(?<actor>.+))', '(?<actor>.+)\\',
    '(?|(?<actor>one)|(?<other>two))', '(?(1)(?<actor>one)|two)', '(?R)(?<actor>.+)',
    '(*MARK:(?<fake>))(?<actor>.+)', '(?n)(?<actor>.+)', '(?<actor>.+)\\g<1>',
    '(?<_KEY_1>.+)=(?<_VAL_1>.+)', '(?<_private>.+)', '(?=(?<actor>.+))text',
    '(?<actor>.+)(?<actor>.+)', '\\x{(?<fake>)}(?<actor>.+)', '(?# unterminated',
    '\\c(?<fake>.+)(?<real>.+)', '[\\c](?<fake>]+(?<real>.+)', '[\\Q](?<fake>'])('unsupported structures discard incomplete field guesses: %s', pattern => {
    const result = namedCaptureDeclarations(pattern); expect(result.complete).toBe(false); expect(result.captures).toEqual([]);
});
test('supported duplicate-name option preserves every group position and literal name', () => {
    expect(namedCaptureDeclarations('(?J)(?<actor>a)|(?<actor>b)')).toMatchObject({ complete: true,
        captures: [{ field: 'actor', group: 1 }, { field: 'actor', group: 2 }] });
});
test('transform key-cleaning opt-out is explicit, not a default for inline extraction', () => {
    expect(namedCaptureDeclarations('(?<_custom>.+)', true)).toMatchObject({ complete: true, captures: [{ field: '_custom' }] });
    expect(inlineExtractionDeclarations('(?<_custom>.+)').complete).toBe(false);
});
test('ordinary lookarounds without capture declarations do not change numbering', () => {
    expect(namedCaptureDeclarations('(?<=prefix)(?<actor>.+?)(?=suffix)(?!bad)')).toMatchObject({ complete: true, groupCount: 1, captures: [{ field: 'actor', group: 1 }] });
});
test('byte, depth and capture fan-out limits reject dense input deterministically', () => {
    expect(namedCaptureDeclarations('é'.repeat(EXTRACTION_PATTERN_BYTES / 2 + 1)).complete).toBe(false);
    expect(namedCaptureDeclarations(`${'(?:'.repeat(EXTRACTION_GROUP_DEPTH + 1)}(?<actor>x)${')'.repeat(EXTRACTION_GROUP_DEPTH + 1)}`).complete).toBe(false);
    expect(namedCaptureDeclarations('()'.repeat(EXTRACTION_CAPTURE_LIMIT + 1)).complete).toBe(false);
});
test('structural declaration recognition is not a claim that PCRE compiles or matches', () => {
    expect(namedCaptureDeclarations('(?<actor>literal){999999999999999}')).toMatchObject({ complete: true, captures: [{ field: 'actor' }] });
});
