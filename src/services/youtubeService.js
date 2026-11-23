const { spawn } = require('node:child_process');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

function youtubeUrl(input) {
    let text = String(input).trim();
    if (/^(?:(?:www\.|m\.|music\.)?youtube\.com|youtu\.be|(?:www\.)?youtube-nocookie\.com)\//i.test(text)) {
        text = 'https://' + text;
    }
    const url = URL.parse(text);
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
        throw new Error('Enter a valid YouTube video URL.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    let id;
    if (url.hostname === 'youtu.be' && parts.length === 1) id = parts[0];
    if (YOUTUBE_HOSTS.has(url.hostname)) {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && parts.length === 2) id = parts[1];
    }
    if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)
        && parts[0] === 'embed' && parts.length === 2) id = parts[1];
    if (!VIDEO_ID.test(id || '')) throw new Error('Use a YouTube video link, such as https://youtu.be/VIDEO_ID.');
    return 'https://www.youtube.com/watch?v=' + id;
}

function parseDuration(value) {
    const match = typeof value === 'string' && value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
    if (!match || !match.slice(1).some(Boolean)) return null;
    return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600
        + Number(match[3] || 0) * 60 + Number(match[4] || 0);
}

function mediaUrl(value) {
    const url = typeof value === 'string' && URL.parse(value);
    if (!url || url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('yt-dlp returned an invalid media stream.');
    }
    return url.href;
}

function parseVideo(info) {
    if (!info || typeof info.id !== 'string' || !VIDEO_ID.test(info.id) || typeof info.title !== 'string') {
        throw new Error('yt-dlp returned invalid video metadata.');
    }
    const formats = info.requested_formats || [info];
    if (!Array.isArray(formats)) throw new Error('yt-dlp returned invalid video formats.');
    const video = formats.find(format => format?.vcodec && format.vcodec !== 'none');
    const audio = formats.find(format => format?.acodec && format.acodec !== 'none');
    if (!video || !audio) throw new Error('This video has no supported stream with both video and audio.');
    const headers = { ...info.http_headers, ...video.http_headers };
    for (const value of Object.values(headers)) {
        if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
            throw new Error('yt-dlp returned invalid stream headers.');
        }
    }
    return {
        id: info.id,
        title: info.title,
        artist: info.channel || info.uploader || 'Unknown channel',
        duration: Number.isFinite(info.duration) && info.duration >= 0 ? info.duration : null,
        url: 'https://www.youtube.com/watch?v=' + info.id,
        playback: {
            source: mediaUrl(video.url), video: true,
            ...(audio !== video ? { audioSource: mediaUrl(audio.url) } : {}),
            userAgent: headers['User-Agent'], referrer: headers.Referer
        }
    };
}

function createYoutube({ fetcher = fetch, spawnProcess = spawn, killProcess = process.kill, env = process.env,
    timeoutMs = 12000, extractionTimeoutMs = 45000 } = {}) {
    async function api(path, params, signal) {
        const timeout = AbortSignal.timeout(timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const url = new URL(path, 'https://www.googleapis.com/youtube/v3/');
        url.search = new URLSearchParams(params);
        try {
            const response = await fetcher(url, {
                signal: combined, headers: { 'X-Goog-Api-Key': env.YOUTUBE_API_KEY }, redirect: 'error'
            });
            if (!response.ok) {
                await response.body?.cancel();
                if (response.status === 429) throw new Error('YouTube rate limit reached. Try again later.');
                if (response.status === 403) throw new Error('YouTube search was denied. Check your API key, API enablement, and quota.');
                if (response.status === 400) throw new Error('YouTube rejected the search. Check YOUTUBE_API_KEY.');
                throw new Error('YouTube returned HTTP ' + response.status + '. Try again later.');
            }
            const body = await response.json();
            if (!Array.isArray(body?.items)) throw new Error('YouTube returned invalid search data.');
            return body.items;
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            if (timeout.aborted) throw new Error('YouTube search timed out. Try again.');
            if (error instanceof SyntaxError) throw new Error('YouTube returned unreadable search data.');
            if (error instanceof TypeError) throw new Error('Could not reach YouTube. Check your internet connection.');
            throw error;
        }
    }

    return {
        async search(query, signal) {
            if (!env.YOUTUBE_API_KEY) throw new Error('YouTube search needs YOUTUBE_API_KEY in .env. You can also paste a video URL.');
            const items = await api('search', { part: 'snippet', type: 'video', q: query, maxResults: '10' }, signal);
            const ids = items.map(item => item?.id?.videoId).filter(id => typeof id === 'string' && VIDEO_ID.test(id));
            if (!ids.length) return [];
            const videos = await api('videos', { part: 'snippet,contentDetails', id: ids.join(',') }, signal);
            const byId = new Map(videos.filter(video => typeof video?.id === 'string' && VIDEO_ID.test(video.id))
                .map(video => [video.id, video]));
            return ids.filter(id => typeof byId.get(id)?.snippet?.title === 'string').map(id => {
                const video = byId.get(id);
                return { id, title: video.snippet.title, artist: video.snippet.channelTitle || 'Unknown channel',
                    duration: parseDuration(video.contentDetails?.duration), url: 'https://www.youtube.com/watch?v=' + id };
            });
        },

        extract(input, signal) {
            const url = youtubeUrl(input);
            if (signal?.aborted) return Promise.reject(signal.reason);
            return new Promise((resolve, reject) => {
                let child;
                try {
                    const { YOUTUBE_API_KEY, AUDIUS_API_KEY, AUDIUS_BEARER_TOKEN, ...childEnv } = env;
                    child = spawnProcess(env.YT_DLP_PATH || 'yt-dlp', [
                        '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--no-warnings',
                        '--skip-download', '--dump-single-json', '--check-formats', '--socket-timeout', '15',
                        '--retries', '1', '--extractor-retries', '1',
                        '--js-runtimes', 'node:' + process.execPath,
                        '--format', 'best[protocol=https]/bestvideo[protocol=https]+bestaudio[protocol=https]/best',
                        '--', url
                    ], { env: childEnv, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
                } catch {
                    reject(new Error('Could not start yt-dlp. Install it or check YT_DLP_PATH.'));
                    return;
                }
                let output = '';
                let diagnostics = '';
                let failure;
                let killTimer;
                function kill(signal) {
                    // Include yt-dlp's JavaScript solver children in macOS cleanup.
                    if (child.pid && process.platform !== 'win32') {
                        try {
                            killProcess(-child.pid, signal);
                            return;
                        } catch {
                            // The group may already have exited.
                        }
                    }
                    child.kill(signal);
                }
                function stop(error) {
                    if (failure) return;
                    failure = error;
                    kill('SIGTERM');
                    killTimer = setTimeout(() => kill('SIGKILL'), 1000);
                }
                const timeout = setTimeout(() => stop(new Error('YouTube stream lookup timed out. Try again.')), extractionTimeoutMs);
                const abort = () => stop(signal.reason);
                signal?.addEventListener('abort', abort, { once: true });
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', chunk => {
                    if (failure) return;
                    output += chunk;
                    if (output.length > 8 * 1024 * 1024) {
                        output = '';
                        stop(new Error('yt-dlp returned too much metadata for this video.'));
                    }
                });
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-16384); });
                child.on('error', error => {
                    failure = new Error(error.code === 'ENOENT'
                        ? 'yt-dlp was not found. Install it with brew install yt-dlp or set YT_DLP_PATH.'
                        : 'Could not run yt-dlp. Check YT_DLP_PATH and its executable permissions.');
                });
                child.once('close', code => {
                    clearTimeout(timeout);
                    clearTimeout(killTimer);
                    signal?.removeEventListener('abort', abort);
                    if (failure) return reject(failure);
                    if (code !== 0) {
                        if (/Requested format is not available|No video formats found|HTTP Error 403|403 Forbidden/i.test(diagnostics)) {
                            return reject(new Error('YouTube did not provide a playable public stream. Try another video or update yt-dlp.'));
                        }
                        const message = /network|connection|timed out|unable to download|resolve|HTTP Error 5/i.test(diagnostics)
                            ? 'Could not reach the YouTube video. Check your connection and try again.'
                            : 'This video could not be opened. It may be unavailable or restricted. Update yt-dlp and try another video.';
                        return reject(new Error(message));
                    }
                    try {
                        resolve(parseVideo(JSON.parse(output)));
                    } catch (error) {
                        reject(error instanceof SyntaxError ? new Error('yt-dlp returned unreadable video metadata.') : error);
                    }
                });
                if (signal?.aborted) abort();
            });
        }
    };
}

module.exports = { createYoutube, youtubeUrl, parseVideo, parseDuration };
