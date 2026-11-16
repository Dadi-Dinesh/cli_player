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
