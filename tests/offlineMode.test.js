const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { scanSongs } = require('../src/modes/offlineMode');

test('scans real files in a custom folder, covering supported extensions and Unicode', async t => {
    const folder = await mkdtemp(join(tmpdir(), 'chill-player-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const names = ['1 空.MP3', '2.wav', '3.flac', '4.m4a', '5.aac', '6.aiff', '7.aif', '10.mp3'];
    await Promise.all(names.map(name => writeFile(join(folder, name), '')));
    await mkdir(join(folder, 'directory.mp3'));
    await writeFile(join(folder, 'readme.txt'), '');
    assert.deepEqual(await scanSongs(folder), names.map(title => ({ title, source: join(folder, title) })));
    assert.deepEqual(await scanSongs(join(folder, 'directory.mp3')), []);
    await assert.rejects(scanSongs(join(folder, 'missing')), /Could not read folder.*ENOENT/);
});

test('blank paths load the repository songs directory', async () => {
    const tracks = await scanSongs('');
    assert.ok(tracks.length > 0);
    assert.equal(tracks[0].source, resolve(__dirname, '../songs', tracks[0].title));
});
