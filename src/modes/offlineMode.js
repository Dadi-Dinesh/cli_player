const { readdir } = require('node:fs/promises');
const { homedir } = require('node:os');
const { extname, join, resolve } = require('node:path');

const defaultFolder = resolve(__dirname, '../../songs');
const formats = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.aiff', '.aif']);

async function scanSongs(input) {
    const path = input.trim();
    const folder = path === '~' ? homedir()
        : path.startsWith('~/') ? resolve(homedir(), path.slice(2))
        : path ? resolve(path) : defaultFolder;

    let files;
    try {
        files = await readdir(folder, { withFileTypes: true });
    } catch (error) {
        throw new Error(`Could not read folder "${folder}" (${error.code}).`, { cause: error });
    }

    return files.filter(file => file.isFile() && formats.has(extname(file.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map(file => ({ title: file.name, source: join(folder, file.name) }));
}

module.exports = { scanSongs };
