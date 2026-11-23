const readline = require('node:readline');
const { VlcPlayer } = require('./player/vlcPlayer');
const { createAudius } = require('./services/audiusApi');
const { scanSongs } = require('./modes/offlineMode');
const { loadYoutube } = require('./modes/youtubeMode');
const { createYoutube } = require('./services/youtubeService');
const { screen } = require('./ui/screen');

function wrap(index, delta, length) {
    return length ? (index + delta + length) % length : 0;
}

function run({
    input = process.stdin, output = process.stdout, player = new VlcPlayer(),
    audius = createAudius(), scan = scanSongs, youtube = createYoutube()
} = {}) {
    if (!input.isTTY || !output.isTTY) throw new Error('Open this player in an interactive terminal.');

    let view = { page: 'welcome' };
    let menuSelection = 0;
    let activeIndex = null;
    let pending;
    let closing;
    const wasRaw = Boolean(input.isRaw);

    function render() {
        if (!closing) output.write('\x1b[H\x1b[2J' + screen(view, player, output) + '\n');
    }

    function cancel() {
        pending?.abort();
        pending = undefined;
    }

    function stopPlayback() {
        cancel();
        view.loadingTrack = false;
        activeIndex = null;
        return player.stop();
    }

    function showMenu() {
        view = { page: 'menu', selected: menuSelection };
        void stopPlayback();
        render();
    }

    function showPrompt(mode, notice = '', text = '') {
        view = { page: 'prompt', mode, notice, input: text };
        void stopPlayback();
        render();
    }

    async function loadTracks() {
        const { mode, input: text } = view;
        const query = text.trim();
        if (mode !== 'offline' && !query) {
            view.notice = mode === 'youtube' ? 'Enter a YouTube video URL or search keywords.'
                : 'Enter a title, artist, or keyword.';
            return render();
        }
        const request = new AbortController();
        pending = request;
        view = { page: 'tracks', mode, query, tracks: [], selected: 0, notice: 'Loading…' };
        render();
        try {
            let tracks;
            if (mode === 'offline') tracks = await scan(text);
            else if (mode === 'youtube') tracks = await loadYoutube(query, youtube, request.signal);
            else tracks = await audius.search(query, request.signal);
            if (request.signal.aborted) return;
            view.tracks = tracks;
            view.notice = tracks.length ? '' : mode === 'offline'
                ? 'No supported audio files. Press S to choose another folder.'
                : 'No tracks found. Press S to try another search.';
        } catch (error) {
            if (request.signal.aborted) return;
            return showPrompt(mode, error.message, text);
        }
        pending = undefined;
        render();
    }

    async function play(index) {
        const track = view.tracks[index];
        if (!track) return;
        void stopPlayback();
        view.selected = index;
        activeIndex = index;
        view.notice = '';
        const request = new AbortController();
        pending = request;
        view.loadingTrack = view.mode !== 'offline';
        render();
        try {
            let source;
            let playback;
            if (view.mode === 'youtube') {
                const video = await youtube.extract(track.url, request.signal);
                if (request.signal.aborted) return;
                const { playback: resolved, ...metadata } = video;
                Object.assign(track, metadata);
                playback = resolved;
                source = resolved.source;
            } else {
                source = track.source || await audius.stream(track, request.signal);
            }
            if (request.signal.aborted) return;
            view.loadingTrack = false;
            await player.play(source, track.artist ? track.title + ' — ' + track.artist : track.title, playback);
        } catch (error) {
            if (request.signal.aborted) return;
            view.notice = error.message;
        }
        if (request.signal.aborted) return;
        pending = undefined;
        view.loadingTrack = false;
        render();
    }

    function exit() {
        if (closing) return closing;
        closing = Promise.resolve().then(() => player.stop());
        cancel();
        input.removeListener('keypress', onKey);
        input.removeListener('end', exit);
        output.removeListener('resize', render);
        player.removeListener('change', render);
        process.removeListener('SIGINT', exit);
        process.removeListener('SIGTERM', exit);
        process.removeListener('SIGHUP', exit);
        process.removeListener('exit', restoreTerminal);
        restoreTerminal();
        input.pause();
        output.write('\n');
        return closing;
    }

    function restoreTerminal() {
        input.setRawMode(wasRaw);
    }

    function onKey(text, key = {}) {
        const { name } = key;
        if (key.ctrl && (name === 'c' || name === 'd')) return void exit();

        if (view.page === 'prompt') {
            if (name === 'escape') return showMenu();
            if (name === 'return' || name === 'enter') return void loadTracks();
            if (name === 'backspace') view.input = Array.from(view.input).slice(0, -1).join('');
            else if (text && !key.ctrl && !key.meta && !/[\p{Cc}]/u.test(text)) view.input += text;
            return render();
        }

        if (name === 'q') return void exit();
        if (view.page === 'welcome') {
            if (name === 'return' || name === 'enter') showMenu();
            return;
        }
        const length = view.page === 'menu' ? 4 : view.tracks.length;
        if (name === 'up' || name === 'down') {
            view.selected = wrap(view.selected, name === 'up' ? -1 : 1, length);
            if (view.page === 'menu') menuSelection = view.selected;
            return render();
        }
        if (view.page === 'menu') {
            if (name !== 'return' && name !== 'enter') return;
            if (menuSelection === 3) return void exit();
            return showPrompt(['offline', 'online', 'youtube'][menuSelection]);
        }

        if (name === 'b' || name === 'escape') return showMenu();
        if (name === 's') return showPrompt(view.mode);
        if (name === 'x') {
            view.notice = '';
            void stopPlayback();
            return render();
        }
        if (name === 'return' || name === 'enter') return void play(view.selected);
        if (name === 'left' || name === 'right') {
            return void play(wrap(activeIndex ?? view.selected, name === 'left' ? -1 : 1, length));
        }
        if (name === 'space' || name === 'p') {
            if (player.status === 'Stopped' && !view.loadingTrack) return void play(view.selected);
            return player.togglePause();
        }
        if (text === '+' || text === '=') player.setVolume(player.volume + 10);
        if (text === '-') player.setVolume(player.volume - 10);
    }

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    process.once('exit', restoreTerminal);
    process.once('SIGINT', exit);
    process.once('SIGTERM', exit);
    process.once('SIGHUP', exit);
    input.on('keypress', onKey);
    input.once('end', exit);
    output.on('resize', render);
    player.on('change', render);
    input.resume();
    render();
    return { exit };
}

module.exports = { run, wrap };
