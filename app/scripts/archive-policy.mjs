import { gunzipSync } from 'node:zlib';

// Both GNU tar and bsdtar support USTAR. Unlike PAX it cannot carry source
// extended attributes, ACLs, file flags or vendor-specific metadata records.
export function cleanTarOptions(bsd) {
    return [
        '--format=ustar', '--no-xattrs', '--no-acls',
        ...(bsd
            ? ['--no-fflags', '--uid=0', '--gid=0', '--uname=root', '--gname=root']
            : ['--owner=0', '--group=0', '--numeric-owner']),
    ];
}

/** Inspect raw headers: tar -t does not expose PAX metadata as ordinary files. */
export function assertCleanArchiveHeaders(archive) {
    const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
    if (tar.length % 512 !== 0) throw new Error('Truncated tar block.');
    let entries = 0;
    for (let offset = 0; offset < tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) {
            if (tar.subarray(offset).some((byte) => byte !== 0)) {
                throw new Error('Unexpected data after the tar terminator.');
            }
            if (!entries) throw new Error('Release archive is empty.');
            return { entries };
        }
        const text = (start, end) => header.subarray(start, end).toString('utf8').split('\0')[0];
        const type = text(156, 157);
        if (!['', '0', '5'].includes(type)) {
            throw new Error(`Forbidden tar extension or non-file record type: ${type}`);
        }
        if (text(257, 263) !== 'ustar') throw new Error('Release must use portable USTAR headers.');
        const octal = (start, end) => {
            const value = text(start, end).trim();
            if (!/^[0-7]+$/.test(value)) throw new Error('Invalid tar numeric field.');
            return Number.parseInt(value, 8);
        };
        const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
        if (sum !== octal(148, 156)) throw new Error('Invalid tar header checksum.');
        if (octal(108, 116) !== 0 || octal(116, 124) !== 0 ||
            !['', 'root'].includes(text(265, 297)) || !['', 'root'].includes(text(297, 329))) {
            throw new Error('Archive ownership must not expose the build-machine user.');
        }
        const size = octal(124, 136);
        const next = offset + 512 + Math.ceil(size / 512) * 512;
        if (!Number.isSafeInteger(next) || next > tar.length) throw new Error('Truncated tar payload.');
        entries += 1;
        offset = next;
    }
    throw new Error('Missing tar terminator.');
}
