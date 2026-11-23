async function loadYoutube(query, youtube, signal) {
    if (/^(?:[a-z][a-z\d+.-]*:\/\/|\/\/|www\.|(?:m\.|music\.)?youtube\.com(?:\/|$)|youtu\.be(?:\/|$)|youtube-nocookie\.com(?:\/|$))/i.test(query)) {
        const { playback, ...video } = await youtube.extract(query, signal);
        return [video];
    }
    return youtube.search(query, signal);
}

module.exports = { loadYoutube };
