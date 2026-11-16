const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { setImmediate: flush, setTimeout: delay } = require('node:timers/promises');
const { run, wrap } = require('../src/app');

function start(t, options) {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = output.isTTY = true;
    input.setRawMode = raw => { input.isRaw = raw; };
    output.columns = 100;
    const player = Object.assign(new EventEmitter(), {
        status: 'Stopped', track: null, volume: 100, sources: [],
        async play(source, title) {
            this.sources.push(source);
            this.track = title;
            this.status = 'Playing';
            this.emit('change');
        },
        togglePause() {
            this.status = this.status === 'Paused' ? 'Playing' : 'Paused';
            this.emit('change');
        },
        setVolume(volume) {
            this.volume = volume;
            this.emit('change');
        },
        async stop() {
            this.track = null;
            this.status = 'Stopped';
            this.emit('change');
        }
    });
    let frame = '';
    output.on('data', chunk => { frame = chunk.toString(); });
    const app = run({ input, output, player, ...options });
    t.after(() => app.exit());
    return { player, input, frame: () => frame, type: keys => input.write(keys) };
}

test('navigation wraps and safely handles an empty list', () => {
    assert.equal(wrap(0, -1, 3), 2);
    assert.equal(wrap(2, 1, 3), 0);
    assert.equal(wrap(0, 1, 0), 0);
});

test('offline flow handles invalid paths, defaults, controls, back and Ctrl+C', async t => {
    const paths = [];
    const ui = start(t, {
        scan: async path => {
            paths.push(path);
            if (path) throw Error('Could not read folder');
            return [{ title: 'First', source: '/first.mp3' }, { title: 'Second', source: '/second.wav' }];
        }
    });
    assert.match(ui.frame(), /Press ENTER to Start/);
    assert.equal(ui.input.isRaw, true);
    ui.type('\r');
    assert.match(ui.frame(), /> 1\. OFFLINE MUSIC/);
    ui.type('\r');
    assert.match(ui.frame(), /Songs folder/);
    ui.type('Q B+空\r');
    await flush();
    assert.deepEqual(paths, ['Q B+空']);
    assert.match(ui.frame(), /Could not read folder/);
    ui.type('\x7f'.repeat(6) + '\r');
    await flush();
    assert.equal(paths.at(-1), '');
    assert.match(ui.frame(), /> 1\. First/);
    ui.type('\x1b[B\r');
    await flush();
    assert.equal(ui.player.sources.at(-1), '/second.wav');
    ui.type(' ');
    assert.match(ui.frame(), /Paused/);
    ui.type('p+');
    assert.match(ui.frame(), /Playing.*110%/);
    ui.type('\x1b[C');
    await flush();
    assert.equal(ui.player.sources.at(-1), '/first.mp3');
    ui.type('\x1b[D');
    await flush();
    assert.equal(ui.player.sources.at(-1), '/second.wav');
    ui.type('-x');
    assert.equal(ui.player.volume, 100);
    assert.equal(ui.player.status, 'Stopped');
    ui.type('b');
    assert.match(ui.frame(), /OFFLINE MUSIC/);
    ui.type('\x03');
    await flush();
    assert.equal(ui.input.isRaw, false);
    assert.equal(ui.player.status, 'Stopped');
});

test('online flow displays live-response fields, streams selections and supports searching again', async t => {
    const queries = [];
    const track = { id: 'track1', title: 'First', artist: 'Artist', duration: 63, streamable: true };
    const ui = start(t, {
        audius: {
            search: async query => {
                queries.push(query);
                if (query === 'fails') throw Error('Could not reach Audius');
                return query === 'empty' ? [] : [track, { ...track, id: 'track2', title: 'Second' }];
            },
            stream: async ({ id }) => 'https://media.example/' + id
        }
    });
    ui.type('\r\x1b[B\r');
    ui.type('quiet Bass\r');
    await flush();
    assert.deepEqual(queries, ['quiet Bass']);
    assert.match(ui.frame(), /First — Artist \[1:03\]/);
    ui.type('\r');
    await flush();
    assert.equal(ui.player.sources.at(-1), 'https://media.example/track1');
    ui.type('\x1b[C');
    await flush();
    assert.equal(ui.player.sources.at(-1), 'https://media.example/track2');
    ui.type('p-');
    assert.match(ui.frame(), /Paused.*90%/);
    ui.type('sempty\r');
    await flush();
    assert.match(ui.frame(), /No tracks found/);
    ui.type('sfails\r');
    await flush();
    assert.match(ui.frame(), /Could not reach Audius/);
    ui.type('\x1b');
    await delay(550);
    assert.match(ui.frame(), /> 2\. ONLINE MUSIC/);
    ui.type('q');
    await flush();
    assert.equal(ui.input.isRaw, false);
});

test('leaving online mode aborts a pending stream and ignores a late result', async t => {
    let finish;
    let pendingSignal;
    const ui = start(t, {
        audius: {
            search: async () => [{ id: 'track', title: 'Track' }],
            stream: (_track, signal) => {
                pendingSignal = signal;
                return new Promise(resolve => { finish = resolve; });
            }
        }
    });
    ui.type('\r\x1b[B\rtrack\r');
    await flush();
    ui.type('\rb');
    assert.equal(pendingSignal.aborted, true);
    finish('https://media.example/track');
    await flush();
    assert.deepEqual(ui.player.sources, []);
    assert.match(ui.frame(), /OFFLINE MUSIC/);
});
