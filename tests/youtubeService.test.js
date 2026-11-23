const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createYoutube, youtubeUrl, parseVideo, parseDuration } = require('../src/services/youtubeService');
const { loadYoutube } = require('../src/modes/youtubeMode');

const id = 'BaW_jenozKc';
const url = 'https://www.youtube.com/watch?v=' + id;
const videoInfo = {
    id, title: 'Test video', channel: 'Channel', duration: 12,
    url: 'https://media.example/video.mp4', vcodec: 'h264', acodec: 'aac',
    http_headers: { 'User-Agent': 'Test agent', Referer: 'https://www.youtube.com/' }
};

function fakeExtractor(result = videoInfo, { code = 0, stderr = '', hang = false } = {}) {
    const calls = [];
    const spawnProcess = (executable, args, options) => {
        const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(), stderr: new PassThrough(), kills: []
        });
        let closed = false;
        child.kill = signal => {
            child.kills.push(signal);
            if (!closed) {
                closed = true;
                setImmediate(() => child.emit('close', null));
            }
        };
        calls.push({ executable, args, options, child });
        if (!hang) setImmediate(() => {
            child.stdout.write(typeof result === 'string' ? result : JSON.stringify(result));
            child.stderr.write(stderr);
            child.emit('close', code);
            closed = true;
        });
        return child;
    };
    return { spawnProcess, calls };
}

test('validates and canonicalizes YouTube video URL formats', () => {
    for (const input of [
        url, url + '&list=PLexample&t=30', 'youtu.be/' + id + '?si=example',
        'http://m.youtube.com/watch?v=' + id, 'https://music.youtube.com/watch?v=' + id,
        'https://www.youtube.com/shorts/' + id, 'https://youtube.com/live/' + id,
        'https://www.youtube.com/embed/' + id, 'https://youtube.com/v/' + id,
        'https://www.youtube-nocookie.com/embed/' + id
    ]) assert.equal(youtubeUrl(input), url);
    for (const input of [
        '', id, 'https://example.com/watch?v=' + id, 'https://youtube.com.evil.example/watch?v=' + id,
        'https://youtube.com@evil.example/watch?v=' + id, 'file:///etc/passwd',
        'ftp://youtube.com/watch?v=' + id, 'https://youtube.com:123/watch?v=' + id,
        'https://youtube.com/playlist?list=PL123', 'https://youtu.be/short',
        'https://youtube.com/watch?v=' + id + ';touch /tmp/a', 'ytsearch:music'
    ]) assert.throws(() => youtubeUrl(input), /YouTube/);
});

test('parses video metadata and separate video/audio streams', () => {
    const video = parseVideo(videoInfo);
    assert.equal(video.title, 'Test video');
    assert.equal(video.artist, 'Channel');
    assert.equal(video.duration, 12);
    assert.equal(video.url, url);
    assert.deepEqual(video.playback, {
        source: 'https://media.example/video.mp4', video: true,
        userAgent: 'Test agent', referrer: 'https://www.youtube.com/'
    });
    const split = parseVideo({ ...videoInfo, requested_formats: [
        { url: 'https://media.example/video', vcodec: 'h264', acodec: 'none' },
        { url: 'https://media.example/audio', vcodec: 'none', acodec: 'aac' }
    ] });
    assert.equal(split.playback.source, 'https://media.example/video');
    assert.equal(split.playback.audioSource, 'https://media.example/audio');
    assert.equal(parseDuration('P1DT2H3M4S'), 93784);
    assert.equal(parseDuration('PT1M'), 60);
    assert.equal(parseDuration('missing'), null);
    assert.throws(() => parseVideo({}), /invalid video metadata/);
    assert.throws(() => parseVideo({ ...videoInfo, requested_formats: {} }), /invalid video formats/);
    assert.throws(() => parseVideo({ ...videoInfo, requested_formats: [null] }), /both video and audio/);
    assert.throws(() => parseVideo({ ...videoInfo, vcodec: 'none' }), /both video and audio/);
    assert.throws(() => parseVideo({ ...videoInfo, url: 'file:///etc/passwd' }), /invalid media/);
    assert.throws(() => parseVideo({ ...videoInfo, http_headers: { 'User-Agent': 'a\nb' } }), /invalid stream headers/);
});

test('uses official search and videos endpoints and preserves search ordering', async () => {
    const calls = [];
    const api = createYoutube({
        env: { YOUTUBE_API_KEY: 'test-key' },
        fetcher: async (endpoint, options) => {
            calls.push({ endpoint, options });
            return Response.json({ items: endpoint.pathname.endsWith('/search') ? [
                { id: { videoId: id } }, { id: { videoId: 'jNQXAC9IVRw' } }, { id: { channelId: 'channel' } }
            ] : [
                { id: 'jNQXAC9IVRw', snippet: { title: 'Second', channelTitle: 'Another channel' }, contentDetails: { duration: 'PT1M3S' } },
                { id, snippet: { title: 'First', channelTitle: 'Channel' }, contentDetails: { duration: 'PT12S' } }
            ] });
        }
    });
    const results = await api.search('A&B 空');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].endpoint.origin, 'https://www.googleapis.com');
    assert.equal(calls[0].endpoint.pathname, '/youtube/v3/search');
    assert.equal(calls[0].endpoint.searchParams.get('q'), 'A&B 空');
    assert.equal(calls[0].endpoint.searchParams.get('type'), 'video');
    assert.equal(calls[0].options.headers['X-Goog-Api-Key'], 'test-key');
    assert.equal(calls[1].endpoint.pathname, '/youtube/v3/videos');
    assert.deepEqual(results.map(video => [video.title, video.artist, video.duration]), [
        ['First', 'Channel', 12], ['Second', 'Another channel', 63]
    ]);
    assert.equal(results[0].url, url);
});

test('search handles missing keys, empty results, HTTP errors, invalid data and network failures', async () => {
    await assert.rejects(createYoutube({ env: {} }).search('music'), /YOUTUBE_API_KEY/);
    for (const [response, expected] of [
        [Response.json({ items: [] }), []],
        [new Response('', { status: 403 }), /API key.*quota/],
        [new Response('', { status: 429 }), /rate limit/],
        [new Response('', { status: 503 }), /HTTP 503/],
        [Response.json({}), /invalid search data/],
        [new Response('bad JSON'), /unreadable/]
    ]) {
        const api = createYoutube({ env: { YOUTUBE_API_KEY: 'key' }, fetcher: async () => response });
        if (Array.isArray(expected)) assert.deepEqual(await api.search('empty'), expected);
        else await assert.rejects(api.search('music'), expected);
    }
    const api = createYoutube({ env: { YOUTUBE_API_KEY: 'key' }, fetcher: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(api.search('music'), /internet connection/);
});

test('extracts metadata with spawn arguments, no shell, and no downloads', async () => {
    const mock = fakeExtractor();
    const api = createYoutube({ ...mock, env: { YT_DLP_PATH: '/tools/yt-dlp', PATH: '/bin', YOUTUBE_API_KEY: 'secret' } });
    const result = await api.extract(url + '&x=$(touch /tmp/injection)');
    assert.equal(result.title, 'Test video');
    const [call] = mock.calls;
    assert.equal(call.executable, '/tools/yt-dlp');
    assert.equal(call.args.at(-1), url);
    assert.equal(call.args.at(-2), '--');
    assert.ok(call.args.includes('--skip-download'));
    assert.ok(call.args.includes('--ignore-config'));
    assert.ok(call.args.includes('--no-playlist'));
    assert.equal(call.options.shell, undefined);
    assert.equal(call.options.env.YOUTUBE_API_KEY, undefined);
    assert.equal(call.options.env.PATH, '/bin');
    assert.throws(() => api.extract('https://evil.example/video'), /YouTube/);
    assert.equal(mock.calls.length, 1);
});

test('extraction handles unavailable videos, network errors, malformed output and missing yt-dlp', async () => {
    for (const [mock, expected] of [
        [fakeExtractor({}, { code: 1, stderr: 'Video unavailable' }), /unavailable or restricted/],
        [fakeExtractor({}, { code: 1, stderr: 'Unable to download webpage: connection reset' }), /connection/],
        [fakeExtractor('bad json'), /unreadable video metadata/]
    ]) await assert.rejects(createYoutube(mock).extract(url), expected);
    const api = createYoutube({ spawnProcess: () => {
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        setImmediate(() => {
            child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
            child.emit('close', -2);
        });
        return child;
    } });
    await assert.rejects(api.extract(url), /yt-dlp was not found/);
});

test('timeout and cancellation terminate extraction before rejecting', async () => {
    const timed = fakeExtractor(null, { hang: true });
    await assert.rejects(createYoutube({ ...timed, extractionTimeoutMs: 10 }).extract(url), /timed out/);
    assert.deepEqual(timed.calls[0].child.kills, ['SIGTERM']);
    const mock = fakeExtractor(null, { hang: true });
    const controller = new AbortController();
    const pending = createYoutube(mock).extract(url, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(mock.calls[0].child.kills, ['SIGTERM']);
    await assert.rejects(createYoutube(mock).extract(url, controller.signal), { name: 'AbortError' });
    assert.equal(mock.calls.length, 1);
});

test('routes URLs to extraction and keywords to official search', async () => {
    const calls = [];
    const api = {
        extract: async input => { calls.push(['extract', input]); return parseVideo(videoInfo); },
        search: async input => { calls.push(['search', input]); return []; }
    };
    const [track] = await loadYoutube(url, api);
    assert.equal(track.url, url);
    assert.equal(track.playback, undefined);
    await loadYoutube('music to study', api);
    assert.deepEqual(calls, [['extract', url], ['search', 'music to study']]);
});

test('macOS cancellation terminates yt-dlp and its JavaScript solver process group', { skip: process.platform === 'win32' }, async () => {
    const mock = fakeExtractor(null, { hang: true });
    const signals = [];
    const controller = new AbortController();
    const api = createYoutube({
        spawnProcess: (...args) => {
            const child = mock.spawnProcess(...args);
            child.pid = 12345;
            return child;
        },
        killProcess: (pid, signal) => {
            signals.push([pid, signal]);
            setImmediate(() => mock.calls[0].child.emit('close', null));
        }
    });
    const extraction = api.extract(url, controller.signal);
    controller.abort();
    await assert.rejects(extraction, { name: 'AbortError' });
    assert.deepEqual(signals, [[-12345, 'SIGTERM']]);
    assert.equal(mock.calls[0].options.detached, true);
});
