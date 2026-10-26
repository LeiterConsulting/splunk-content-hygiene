/* eslint-disable no-restricted-syntax, no-continue -- A bounded lexer, never a customer regex engine. */
export const EXTRACTION_PATTERN_BYTES = 65536;
export const EXTRACTION_CAPTURE_LIMIT = 250;
export const EXTRACTION_GROUP_DEPTH = 64;
export interface CaptureDeclaration { field: string; group: number; offset: number }
export interface CaptureDeclarations {
    captures: CaptureDeclaration[];
    groupCount: number | null;
    complete: boolean;
    reason: string | null;
}
const failed = (reason: string): CaptureDeclarations => ({ captures: [], groupCount: null, complete: false, reason });
function bounded(text: string): boolean {
    if (!text || text.length > EXTRACTION_PATTERN_BYTES) { return false; }
    let bytes = 0;
    for (const character of text) {
        const code = character.codePointAt(0)!;
        if (code === 127 || code < 32 && ![9, 10, 13].includes(code)) { return false; }
        if (code <= 0x7f) { bytes += 1; }
        else if (code <= 0x7ff) { bytes += 2; }
        else if (code <= 0xffff) { bytes += 3; }
        else { bytes += 4; }
        if (bytes > EXTRACTION_PATTERN_BYTES) { return false; }
    }
    return true;
}

/**
 * Recognizes declaration boundaries/numbering only. It does not compile, run or
 * certify PCRE. Offsets are zero-based UTF-16 offsets in the returned definition.
 * Unsupported control/group-numbering constructs discard all guessed names.
 */
export function namedCaptureDeclarations(text: string, allowLeadingUnderscore = false): CaptureDeclarations {
    if (!bounded(text)) { return failed('Pattern is empty, contains unsupported control characters or exceeds the declaration byte budget.'); }
    const captures: CaptureDeclaration[] = [];
    const names = new Set<string>();
    const stack: Array<{ extended: boolean; duplicateNames: boolean; assertion: boolean }> = [];
    let extended = false; let duplicateNames = false; let assertion = false; let groupCount = 0;
    const open = (isAssertion = false): boolean => {
        if (stack.length >= EXTRACTION_GROUP_DEPTH) { return false; }
        stack.push({ extended, duplicateNames, assertion }); assertion ||= isAssertion; return true;
    };
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (c === '\\') {
            const escape = text[i + 1];
            if (escape === undefined) { return failed('Unterminated pattern escape; capture declarations remain unverified.'); }
            if (escape === 'Q') {
                const end = text.indexOf('\\E', i + 2);
                if (end < 0) { i = text.length; } else { i = end + 1; }
            } else if (['g', 'k', 'N', 'c'].includes(escape)) {
                return failed('Subroutine, named-reference, control-character or named-character escapes are outside the declaration subset.');
            } else if (['p', 'P', 'x', 'o'].includes(escape) && text[i + 2] === '{') {
                const end = text.indexOf('}', i + 3); const body = end < 0 ? '' : text.slice(i + 3, end);
                let valid = /^[\w^=& -]{1,64}$/.test(body);
                if (escape === 'x') { valid = /^[\da-f]{1,8}$/i.test(body); }
                else if (escape === 'o') { valid = /^[0-7]{1,8}$/.test(body); }
                if (!valid) { return failed('Unsupported or unterminated braced escape; capture declarations remain unverified.'); }
                i = end;
            } else { i += 1; }
            continue;
        }
        if (extended && c === '#') { const end = text.indexOf('\n', i + 1); i = end < 0 ? text.length : end; continue; }
        if (c === '[') {
            let cursor = i + 1; let closed = false;
            if (text[cursor] === '^') { cursor += 1; }
            if (text[cursor] === ']') { cursor += 1; }
            for (; cursor < text.length; cursor += 1) {
                if (text[cursor] === '\\') {
                    if (text[cursor + 1] === 'c') { return failed('Control-character escapes inside classes are outside the declaration subset.'); }
                    if (text[cursor + 1] === 'Q') {
                        const end = text.indexOf('\\E', cursor + 2);
                        if (end < 0) { return failed('Unterminated quoted character class.'); }
                        cursor = end + 1;
                    } else { cursor += 1; }
                    continue;
                }
                if (text[cursor] === '[' && [':', '.', '='].includes(text[cursor + 1])) {
                    const end = text.indexOf(`${text[cursor + 1]}]`, cursor + 2);
                    if (end < 0) { return failed('Unterminated bracket-class declaration.'); }
                    cursor = end + 1; continue;
                }
                if (text[cursor] === ']') { closed = true; break; }
            }
            if (!closed) { return failed('Unterminated character class; capture declarations remain unverified.'); }
            i = cursor; continue;
        }
        if (c === ')') {
            const parent = stack.pop(); if (!parent) { return failed('Unbalanced group boundaries; capture declarations remain unverified.'); }
            ({ extended, duplicateNames, assertion } = parent); continue;
        }
        if (c !== '(') { continue; }
        const offset = i;
        if (text[i + 1] === '*') { return failed('Backtracking verbs and other pattern controls are outside the declaration subset.'); }
        let field: string | null = null; let capture = text[i + 1] !== '?'; let isAssertion = false;
        if (!capture) {
            const kind = text[i + 2];
            if (kind === '#') {
                const end = text.indexOf(')', i + 3);
                if (end < 0) { return failed('Unterminated pattern comment.'); }
                i = end; continue;
            }
            if (kind === ':' || kind === '>' || kind === '=' || kind === '!') {
                isAssertion = kind === '=' || kind === '!'; i += 2;
            } else if (kind === '<' && ['=', '!'].includes(text[i + 3])) {
                isAssertion = true; i += 3;
            } else if (kind === '<' || kind === "'" || kind === 'P' && text[i + 3] === '<') {
                const start = i + (kind === 'P' ? 4 : 3); const terminator = kind === "'" ? "'" : '>';
                const end = text.indexOf(terminator, start);
                if (end < 0 || end - start > 32) { return failed('Unterminated or oversized named-capture declaration.'); }
                field = text.slice(start, end);
                if (/^_(?:KEY|VAL)_/.test(field)) { return failed('Dynamic KEY/VAL captures do not declare literal output field names.'); }
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || !allowLeadingUnderscore && field.startsWith('_')) {
                    return failed('Capture name is outside the literal/key-cleaning-safe field-name subset.');
                }
                if (names.has(field) && !duplicateNames) { return failed('Duplicate named captures without an explicit supported duplicate-name option remain unverified.'); }
                capture = true; i = end;
            } else {
                let cursor = i + 2;
                while (cursor < text.length && /[A-Za-z-]/.test(text[cursor])) { cursor += 1; }
                const options = text.slice(i + 2, cursor);
                if (!/^(?:[imsxUJ]+(?:-[imsxUJ]+)?|-[imsxUJ]+)$/.test(options) || ![':', ')'].includes(text[cursor])) {
                    return failed('Conditional, recursive, branch-reset or unsupported option groups remain unverified.');
                }
                const scoped = text[cursor] === ':';
                if (scoped && !open()) { return failed('Pattern group-depth budget reached.'); }
                let enabled = true;
                for (const option of options) {
                    if (option === '-') { enabled = false; }
                    else if (option === 'x') { extended = enabled; }
                    else if (option === 'J') { duplicateNames = enabled; }
                }
                i = cursor; continue;
            }
        }
        if (capture) {
            if (assertion) { return failed('Capturing groups inside assertions are not attributed as output producers.'); }
            groupCount += 1;
            if (groupCount > EXTRACTION_CAPTURE_LIMIT) { return failed('Pattern capture-count budget reached.'); }
            if (field) { captures.push({ field, group: groupCount, offset }); names.add(field); }
        }
        if (!open(isAssertion)) { return failed('Pattern group-depth budget reached.'); }
    }
    if (stack.length) { return failed('Unbalanced group boundaries; capture declarations remain unverified.'); }
    return { captures, groupCount, complete: true, reason: null };
}

export interface InlineDeclarations extends CaptureDeclarations {
    sourceField: string | null;
    sourceOrigin: 'default_raw' | 'explicit_inline' | 'unknown';
}
export function inlineExtractionDeclarations(text: string): InlineDeclarations {
    if (!bounded(text)) { return { ...failed('Inline declaration exceeds its byte/control-character budget.'), sourceField: null, sourceOrigin: 'unknown' }; }
    let pattern = text; let sourceField = '_raw'; let sourceOrigin: InlineDeclarations['sourceOrigin'] = 'default_raw';
    // A terminal literal clause, not every occurrence of " in " in the body.
    const suffix = /[ \t]+in[ \t]+([A-Za-z0-9_]{1,4096})[ \t]*$/.exec(text);
    if (suffix) {
        pattern = text.slice(0, suffix.index); [, sourceField] = suffix; sourceOrigin = 'explicit_inline';
    } else if (/[ \t]+in(?:[ \t]*$|[ \t]+[^\s()[\]{}\\|]+[ \t]*$)/.test(text)) {
        return { ...failed('Inline source-field clause is ambiguous or outside the literal supported syntax.'), sourceField: null, sourceOrigin: 'unknown' };
    }
    const result = namedCaptureDeclarations(pattern);
    if (result.complete && !result.captures.length) {
        return { ...failed('Inline EXTRACT has no supported literal named-capture outputs.'), sourceField, sourceOrigin };
    }
    return { ...result, sourceField, sourceOrigin };
}
