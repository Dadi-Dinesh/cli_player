const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { VlcPlayer, findVlc, toVlcVolume } = require('../src/player/vlcPlayer');

function mockVlc() {
    const child = Object.assign(new EventEmitter(), {
        exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(),
        stderr: new PassThrough(), commands: []
    });
    child.stdin.on('data', data => child.commands.push(data.toString().trim()));
    child.finish = code => {
        child.exitCode = code;
        child.stdin.end();
        child.emit('close', code);
    };
    child.kill = () => setImmediate(() => child.finish(null));
    return child;
}

test('VLC volume uses 256 at 100% and caps at 512', () => {
    assert.deepEqual([-3, 0, 50, 100, 110, 200, 300].map(toVlcVolume), [0, 0, 128, 256, 282, 512, 512]);
    assert.throws(() => findVlc({ VLC_PATH: '/missing/vlc' }), /VLC_PATH/);
});

test('tracks acknowledged state, persists volume and serializes replacement', async t => {
    const children = [];
    const player = new VlcPlayer({
        executable: () => 'vlc',
        spawnProcess: (_, args) => {
            const previous = children.at(-1);
            if (previous) assert.equal(previous.stdin.writableEnded, true);
            const child = mockVlc();
            child.source = args.at(-1);
            children.push(child);
            return child;
        }
    });
    t.after(() => player.stop());
    await player.play('/music/空 song.mp3', 'First');
    const [first] = children;
    assert.equal(player.status, 'Starting');
    assert.equal(first.source, '/music/空 song.mp3');
    first.stdout.write('status change: ( play');
    first.stdout.write(' state: 3 )\r\n');
    assert.equal(player.status, 'Playing');
    assert.equal(first.commands.at(-1), 'volume 256');

    player.togglePause();
    player.togglePause();
    assert.equal(player.status, 'Playing');
    assert.equal(first.commands.filter(command => command === 'pause').length, 1);
    first.stdout.write('status change: ( pause state: 4 )\r\n');
    assert.equal(player.status, 'Paused');
    player.setVolume(60);
    assert.equal(first.commands.at(-1), 'volume 154');

    const second = player.play('/second.wav', 'Second');
    const third = player.play('https://media.example/track.mp3', 'Third');
    await Promise.all([second, third]);
    assert.equal(children.length, 2);
    first.stdout.write('status change: ( play state: 3 )\r\n');
    assert.equal(player.status, 'Starting');
    children[1].stdout.write('status change: ( play state: 3 )\r\n');
    assert.equal(player.status, 'Playing');
    assert.equal(player.track, 'Third');
    assert.equal(children[1].commands.at(-1), 'volume 154');
    children[1].finish(0);
    assert.equal(player.status, 'Stopped');
    player.setVolume(70);
    assert.equal(children[1].commands.at(-1), 'volume 154');
});

test('reports spawn failures and handles unavailable audio output', async t => {
    const child = mockVlc();
    const player = new VlcPlayer({ executable: () => 'vlc', spawnProcess: () => child });
    t.after(() => player.stop());
    await player.play('/a.mp3', 'A');
    child.emit('error', Object.assign(new Error('cannot spawn'), { code: 'ENOENT' }));
    child.finish(1);
    assert.equal(player.status, 'Stopped');
    assert.match(player.error, /Could not run VLC/);

    const silent = mockVlc();
    const second = new VlcPlayer({ executable: () => 'vlc', spawnProcess: () => silent });
    t.after(() => second.stop());
    await second.play('/b.mp3', 'B');
    const closed = second.session.closed;
    silent.stderr.write('main decoder error: failed to create audio output\n');
    await closed;
    assert.equal(second.status, 'Stopped');
    assert.match(second.error, /audio output device/);
});

test('enables a visible video window and passes separate audio and HTTP headers as arguments', async t => {
    const calls = [];
    const player = new VlcPlayer({ executable: () => 'vlc', spawnProcess: (executable, args, options) => {
        const child = mockVlc();
        calls.push({ args, options, child });
        return child;
    } });
    t.after(() => player.stop());
    await player.play('https://media.example/video', 'Video', {
        video: true, audioSource: 'https://media.example/audio?x=1&y=2',
        userAgent: 'Test agent', referrer: 'https://www.youtube.com/'
    });
    assert.ok(calls[0].args.includes('--video'));
    if (process.platform === 'darwin') {
        assert.equal(calls[0].args[calls[0].args.indexOf('-I') + 1], 'macosx');
        assert.equal(calls[0].args[calls[0].args.indexOf('--extraintf') + 1], 'oldrc');
    }
    assert.ok(calls[0].args.includes('--no-embedded-video'));
    assert.ok(!calls[0].args.includes('--no-video'));
    assert.ok(calls[0].args.includes('--input-slave=https://media.example/audio?x=1&y=2'));
    assert.ok(calls[0].args.includes('--http-user-agent=Test agent'));
    assert.ok(calls[0].args.includes('--http-referrer=https://www.youtube.com/'));
    assert.equal(calls[0].args.at(-1), 'https://media.example/video');
    assert.equal(calls[0].options.shell, undefined);
    calls[0].child.stdout.write('status change: ( play state: 3 )\r\n');
    player.togglePause();
    assert.equal(calls[0].child.commands.at(-1), 'pause');
    await player.play('/music.mp3', 'Music');
    assert.ok(calls[1].args.includes('--no-video'));
    assert.equal(calls[1].args[calls[1].args.indexOf('-I') + 1], 'oldrc');
    assert.ok(!calls[1].args.some(arg => arg.startsWith('--input-slave=')));
});

test('reports rejected streams and missing macOS video interface without leaving VLC running', async t => {
    for (const [diagnostic, expected] of [
        ['access stream error: HTTP 403 error\n', /HTTP 403.*fresh stream/],
        ['macosx window error: Cannot create vout as Mac OS X interface was not found\n', /video window/]
    ]) {
        const child = mockVlc();
        const player = new VlcPlayer({ executable: () => 'vlc', spawnProcess: () => child });
        t.after(() => player.stop());
        await player.play('https://media.example/video', 'Video', { video: true });
        const closed = player.session.closed;
        child.stderr.write(diagnostic);
        await closed;
        assert.equal(player.status, 'Stopped');
        assert.equal(player.session, null);
        assert.match(player.error, expected);
    }
});
