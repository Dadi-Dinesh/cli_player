const BASE = 'https://api.audius.co/v1/';
const APP_NAME = 'CHILL AVVU MAMA';

function parseTracks(body) {
    if (!Array.isArray(body?.data)) throw new Error('Audius returned an invalid search response.');
    return body.data.filter(track => typeof track?.id === 'string' && /^[a-z0-9]+$/i.test(track.id)
        && typeof track.title === 'string').map(track => ({
        id: track.id,
        title: track.title,
        artist: typeof track.user?.name === 'string' ? track.user.name : 'Unknown artist',
        duration: Number.isFinite(track.duration) && track.duration >= 0 ? track.duration : null,
        streamable: track.access?.stream !== false && track.is_stream_gated !== true
    }));
}

function checkResponse(response, stream) {
    if (response.ok) return;
    if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const delay = /^\d+$/.test(retry || '') ? ` in ${retry} seconds` : ' later';
        throw new Error('Audius rate limit reached. Try again' + delay + '.');
    }
    if (stream && [401, 403, 404, 410, 451].includes(response.status)) {
        throw new Error('This track is unavailable for public streaming.');
    }
    if ([401, 403].includes(response.status)) {
        throw new Error('Audius rejected the request. Check AUDIUS_BEARER_TOKEN if configured.');
    }
    throw new Error(`Audius returned HTTP ${response.status}. Try again later.`);
}

function createAudius({ fetcher = fetch, env = process.env, timeoutMs = 12000 } = {}) {
    async function request(path, params, signal, read, { stream = false } = {}) {
        const url = new URL(path, BASE);
        url.search = new URLSearchParams({ app_name: APP_NAME, ...params });
        const headers = {};
        if (!stream && env.AUDIUS_BEARER_TOKEN) headers.Authorization = 'Bearer ' + env.AUDIUS_BEARER_TOKEN;
        if (stream && env.AUDIUS_API_KEY) url.searchParams.set('api_key', env.AUDIUS_API_KEY);
        const timeout = AbortSignal.timeout(timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let response;
        try {
            response = await fetcher(url, { signal: combined, redirect: 'manual', headers });
        } catch (error) {
            if (signal?.aborted) throw error;
            if (timeout.aborted) throw new Error('Audius request timed out. Try again.');
            throw new Error('Could not reach Audius. Check your internet connection.');
        }
        try {
            return await read(response, url);
        } catch (error) {
            if (signal?.aborted) throw error;
            if (timeout.aborted) throw new Error('Audius request timed out. Try again.');
            throw error;
        } finally {
            if (!response.bodyUsed) void response.body?.cancel().catch(() => {});
        }
    }

    return {
        search(query, signal) {
            return request('tracks/search', { query, limit: '25' }, signal, async response => {
                checkResponse(response, false);
                let body;
                try {
                    body = await response.json();
                } catch {
                    throw new Error('Audius returned an unreadable search response.');
                }
                return parseTracks(body);
            });
        },

        stream(track, signal) {
            if (!track.streamable) throw new Error('This track is unavailable for public streaming.');
            return request(`tracks/${encodeURIComponent(track.id)}/stream`, {}, signal, (response, url) => {
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    const location = response.headers.get('location');
                    const destination = location && URL.parse(location, url);
                    if (destination?.protocol === 'https:' && !destination.username && !destination.password) {
                        return destination.href;
                    }
                    throw new Error('Audius returned an invalid stream redirect.');
                }
                checkResponse(response, true);
                if (/^(audio\/|application\/(octet-stream|vnd\.apple\.mpegurl))/i.test(
                    response.headers.get('content-type') || ''
                )) return url.href;
                throw new Error('Audius returned no playable stream for this track.');
            }, { stream: true });
        }
    };
}

module.exports = { createAudius, parseTracks };
