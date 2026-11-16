const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAudius, parseTracks } = require('../src/services/audiusApi');

test('parses metadata, avoids unsafe IDs, flags restricted tracks and handles empty lists', () => {
    assert.deepEqual(parseTracks({ data: [] }), []);
    assert.throws(() => parseTracks({ data: {} }), /invalid search response/);
    assert.deepEqual(parseTracks({ data: [
        { id: 'ab123', title: 'A', user: { name: 'Artist' }, duration: 123 },
        { id: 'ab456', title: 'B', access: { stream: false } },
        { id: '../bad', title: 'C' }
    ] }), [
        { id: 'ab123', title: 'A', artist: 'Artist', duration: 123, streamable: true },
        { id: 'ab456', title: 'B', artist: 'Unknown artist', duration: null, streamable: false }
    ]);
});

test('encodes search and resolves only the provider-authorized HTTPS stream', async () => {
    const calls = [];
    const audius = createAudius({
        env: { AUDIUS_BEARER_TOKEN: 'test-token', AUDIUS_API_KEY: 'test-key' },
        fetcher: async (url, options) => {
            calls.push({ url, options });
            if (url.pathname.endsWith('search')) {
                return Response.json({ data: [{ id: 'xY123', title: 'Test Track' }] });
            }
            return Response.redirect('https://media.example/track.mp3', 302);
        }
    });
    const [track] = await audius.search('A&B + 空');
    assert.equal(await audius.stream(track), 'https://media.example/track.mp3');
    assert.equal(calls[0].url.pathname, '/v1/tracks/search');
    assert.equal(calls[0].url.searchParams.get('query'), 'A&B + 空');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls[1].url.pathname, '/v1/tracks/xY123/stream');
    assert.equal(calls[1].url.searchParams.get('api_key'), 'test-key');
    assert.equal(calls[1].options.headers.Authorization, undefined);
    assert.equal(calls[1].options.redirect, 'manual');
    assert.throws(() => audius.stream({ ...track, streamable: false }), /unavailable/i);
    assert.equal(calls.length, 2);
});

test('reports rate limits, HTTP errors, malformed data and network failures', async () => {
    for (const [response, message] of [
        [new Response('', { status: 429, headers: { 'retry-after': '10' } }), /10 seconds/],
        [new Response('', { status: 503 }), /HTTP 503/],
        [new Response('invalid json'), /unreadable/]
    ]) {
        const audius = createAudius({ fetcher: async () => response });
        await assert.rejects(audius.search('track'), message);
    }
    const network = createAudius({ fetcher: async () => { throw Error('offline'); } });
    await assert.rejects(network.search('track'), /Check your internet connection/);

    const missing = createAudius({ fetcher: async () => new Response('', { status: 404 }) });
    await assert.rejects(missing.stream({ id: '123', streamable: true }), /unavailable/);
    const unsafe = createAudius({ fetcher: async () => Response.redirect('http://media.example/x', 302) });
    await assert.rejects(unsafe.stream({ id: '123', streamable: true }), /invalid stream redirect/);
});

test('times out and allows user cancellation', async () => {
    const audius = createAudius({
        timeoutMs: 10,
        fetcher: (_url, { signal }) => new Promise((resolve, reject) => {
            const keepAlive = setTimeout(resolve, 1000);
            signal.addEventListener('abort', () => {
                clearTimeout(keepAlive);
                reject(signal.reason);
            }, { once: true });
        })
    });
    await assert.rejects(audius.search('track'), /timed out/);
    const request = new AbortController();
    const search = audius.search('track', request.signal);
    request.abort();
    await assert.rejects(search, { name: 'AbortError' });
});
