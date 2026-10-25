import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { assertCleanArchiveHeaders, cleanTarOptions } from './archive-policy.mjs';

function header(type = '0', size = 0, owner = 'root') {
    const bytes = Buffer.alloc(512);
    const field = (value, offset, length) => bytes.write(value, offset, length, 'utf8');
    field('content_hygiene/default/app.conf', 0, 100);
    field('0000644\0', 100, 8);
    field('0000000\0', 108, 8);
    field('0000000\0', 116, 8);
    field(size.toString(8).padStart(11, '0') + '\0', 124, 12);
    field('00000000000\0', 136, 12);
    field('        ', 148, 8);
    field(type, 156, 1);
    field('ustar\0', 257, 6);
    field('00', 263, 2);
    field(owner, 265, 32);
    field('root', 297, 32);
    const sum = bytes.reduce((total, byte) => total + byte, 0);
    field(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return bytes;
}
const archive = (...parts) => gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

test('portable files and directories with normalized ownership pass raw-header policy', () => {
    assert.equal(assertCleanArchiveHeaders(archive(header('5'), header('0', 3), Buffer.alloc(512))).entries, 2);
});
for (const type of ['x', 'g', 'L', 'K', '2']) {
    test(`extension/link header ${type} cannot hide metadata behind a clean tar listing`, () => {
        assert.throws(() => assertCleanArchiveHeaders(archive(header(type, 80), Buffer.from('LIBARCHIVE.xattr.com.apple.provenance=test'.padEnd(512, '\0')))), /Forbidden tar extension/);
    });
}
test('build-machine ownership is rejected', () => {
    assert.throws(() => assertCleanArchiveHeaders(archive(header('0', 0, 'build-user'))), /ownership/);
});
test('corrupt checksum, truncated blocks and missing terminators fail closed', () => {
    const corrupt = header(); corrupt[0] ^= 1;
    assert.throws(() => assertCleanArchiveHeaders(archive(corrupt)), /checksum/);
    assert.throws(() => assertCleanArchiveHeaders(gzipSync(Buffer.alloc(17))), /Truncated tar block/);
    assert.throws(() => assertCleanArchiveHeaders(archive(header('0', 10000))), /Truncated tar payload/);
    assert.throws(() => assertCleanArchiveHeaders(gzipSync(header())), /terminator/);
    assert.throws(() => assertCleanArchiveHeaders(archive(Buffer.alloc(512), header())), /after the tar terminator/);
});
test('native tar creates a metadata-free package without altering source attributes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hygiene-archive-policy-'));
    try {
        const source = path.join(directory, 'content_hygiene');
        await mkdir(source);
        const file = path.join(source, 'app.conf');
        await writeFile(file, '[id]\nname = content_hygiene\n');
        if (process.platform === 'darwin') {
            assert.equal(spawnSync('xattr', ['-w', 'com.example.hygiene_test', 'source-only', file]).status, 0);
        }
        const artifact = path.join(directory, 'app.tar.gz');
        const bsd = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout.includes('bsdtar');
        const packed = spawnSync('tar', [...cleanTarOptions(bsd), '-czf', artifact, '-C', directory, 'content_hygiene'], {
            encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' },
        });
        assert.equal(packed.status, 0, packed.stderr);
        assert.equal(assertCleanArchiveHeaders(await readFile(artifact)).entries, 2);
        if (process.platform === 'darwin') {
            assert.equal(spawnSync('xattr', ['-p', 'com.example.hygiene_test', file], { encoding: 'utf8' }).stdout.trim(), 'source-only');
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
