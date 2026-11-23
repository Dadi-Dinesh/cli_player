const TITLE = 'CHILL AVVU MAMA';
const MODES = ['OFFLINE MUSIC', 'ONLINE MUSIC', 'YOUTUBE VIDEO PLAYER', 'EXIT'];

function box(lines) {
    const width = 42;
    return ['╔' + '═'.repeat(width) + '╗', ...lines.map(line => {
        if (line === null) return '╠' + '═'.repeat(width) + '╣';
        const [value, left] = Array.isArray(line) ? line : [line, Math.floor((width - line.length) / 2)];
        return '║' + ' '.repeat(left) + value + ' '.repeat(width - left - value.length) + '║';
    }), '╚' + '═'.repeat(width) + '╝'].join('\n');
}

function clean(value) {
    return String(value).replace(/[\p{Cc}\u2028\u2029]/gu, ' ');
}

function duration(seconds) {
    if (seconds === null || seconds === undefined) return '';
    const rounded = Math.floor(seconds);
    return ` [${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}]`;
}

function screen(view, player, size = {}) {
    const rows = size.rows || 24;
    const columns = size.columns || 80;
    if (view.page === 'welcome') {
        return box(['', TITLE, '', 'CLI MUSIC PLAYER', '', '▶ START', '', 'Press ENTER to Start', '']);
    }
    if (view.page === 'menu') {
        return box([TITLE, null, '', ...MODES.map((mode, i) => [
            `${i === view.selected ? '>' : ' '} ${i + 1}. ${mode}`, 4
        ]), '']) + '\n\n↑ ↓   Navigate\nENTER Select\nQ     Quit';
    }

    // A conservative character limit leaves room for wide terminal glyphs.
    const clip = (value, limit = Math.max(12, Math.floor((columns - 2) / 2))) => {
        const chars = Array.from(clean(value));
        return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : chars.join('');
    };
    const headings = { offline: 'OFFLINE MODE', online: 'ONLINE MODE', youtube: 'YOUTUBE VIDEO MODE' };
    const lines = [TITLE, headings[view.mode], ''];
    if (view.page === 'prompt') {
        lines.push(clean(view.notice || ''), 'ESC Back  ·  Ctrl+C Quit', '',
            view.mode === 'offline' ? 'Songs folder (Enter uses ./songs)'
                : view.mode === 'youtube' ? 'Paste a YouTube video URL or enter search keywords'
                    : 'Search by song, artist, or keyword',
            '> ' + clip(Array.from(view.input).slice(-Math.max(12, Math.floor((columns - 4) / 2))).join('')));
        return lines.join('\n');
    }

    if (view.mode !== 'offline') lines.push('Search  ' + clip(view.query));
    const count = Math.max(1, view.mode === 'youtube' ? Math.floor((rows - 14) / 2) : rows - 13);
    const offset = Math.min(Math.max(0, view.selected - Math.floor(count / 2)), Math.max(0, view.tracks.length - count));
    for (const [index, track] of view.tracks.slice(offset, offset + count).entries()) {
        const i = index + offset;
        const label = track.title + (track.artist ? ' — ' + track.artist : '') + duration(track.duration)
            + (track.streamable === false ? ' · Unavailable' : '');
        lines.push(`${i === view.selected ? '>' : ' '} ${i + 1}. ${clip(label, Math.max(12, columns - 10))}`);
        if (view.mode === 'youtube') lines.push('     ' + clean(track.url));
    }
    if (view.tracks.length > count) lines.push(`${offset + 1}–${Math.min(offset + count, view.tracks.length)} of ${view.tracks.length}`);
    if (view.mode === 'youtube') lines.push('Keep Terminal focused for keyboard controls.');
    lines.push('', `${view.loadingTrack ? 'Opening stream' : player.status}${player.track ? ' · ' + clip(player.track, columns - 16) : ''}   Volume ${player.volume}%`);
    lines.push(clean(view.notice || player.error || ''), '',
        '↑ ↓ Select  ·  Enter Play  ·  Space/P Pause  ·  ← → Track',
        '+/− Volume  ·  X Stop  ·  B Back  ·  Q Quit' + (view.mode === 'offline' ? '  ·  S Folder' : '  ·  S Search'));
    return lines.join('\n');
}

module.exports = { screen };
