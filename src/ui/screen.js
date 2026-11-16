const TITLE = 'CHILL AVVU MAMA';
const MODES = ['OFFLINE MUSIC', 'ONLINE MUSIC', 'EXIT'];

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

function screen(view, player, { rows = 24, columns = 80 } = {}) {
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
    const lines = [TITLE, view.mode === 'offline' ? 'OFFLINE MODE' : 'ONLINE MODE', ''];
    if (view.page === 'prompt') {
        lines.push(clip(view.notice || ''), 'ESC Back  ·  Ctrl+C Quit', '',
            view.mode === 'offline' ? 'Songs folder (Enter uses ./songs)' : 'Search by song, artist, or keyword',
            '> ' + clip(Array.from(view.input).slice(-Math.max(12, Math.floor((columns - 4) / 2))).join('')));
        return lines.join('\n');
    }

    if (view.mode === 'online') lines.push('Search  ' + clip(view.query));
    const count = Math.max(1, rows - 13);
    const offset = Math.min(Math.max(0, view.selected - Math.floor(count / 2)), Math.max(0, view.tracks.length - count));
    for (const [index, track] of view.tracks.slice(offset, offset + count).entries()) {
        const i = index + offset;
        const label = track.title + (track.artist ? ' — ' + track.artist : '') + duration(track.duration)
            + (track.streamable === false ? ' · Unavailable' : '');
        lines.push(`${i === view.selected ? '>' : ' '} ${i + 1}. ${clip(label, Math.max(12, columns - 10))}`);
    }
    if (view.tracks.length > count) lines.push(`${offset + 1}–${Math.min(offset + count, view.tracks.length)} of ${view.tracks.length}`);
    lines.push('', `${view.loadingTrack ? 'Opening stream' : player.status}${player.track ? ' · ' + clip(player.track, columns - 16) : ''}   Volume ${player.volume}%`);
    lines.push(clip(view.notice || player.error || '', Math.max(12, columns - 3)), '',
        '↑ ↓ Select  ·  Enter Play  ·  Space/P Pause  ·  ← → Track',
        '+/− Volume  ·  X Stop  ·  B Back  ·  Q Quit' + (view.mode === 'online' ? '  ·  S Search' : '  ·  S Folder'));
    return lines.join('\n');
}

module.exports = { screen };
