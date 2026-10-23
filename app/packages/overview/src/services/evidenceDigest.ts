import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) { return value.map(canonical); }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => {
            if (a === b) { return 0; }
            return a < b ? -1 : 1;
        })
            .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
}

export function evidenceDigest(value: unknown): string {
    return bytesToHex(sha256(utf8ToBytes(JSON.stringify(canonical(value)))));
}
