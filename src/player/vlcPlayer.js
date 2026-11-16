const { spawn } = require('node:child_process');
const { accessSync, constants } = require('node:fs');
const { delimiter, resolve } = require('node:path');
const { EventEmitter } = require('node:events');

const MAC_VLC = '/Applications/VLC.app/Contents/MacOS/VLC';

function findVlc(env = process.env) {
    const names = env.VLC_PATH ? [env.VLC_PATH] : [MAC_VLC, 'vlc'];
    for (const name of names) {
        const paths = name.includes('/') ? [resolve(name)]
            : (env.PATH || '').split(delimiter).filter(Boolean).map(dir => resolve(dir, name));
        for (const path of paths) {
            try {
                accessSync(path, constants.X_OK);
                return path;
            } catch {
                // Try the next PATH entry.
            }
        }
    }
    throw new Error(env.VLC_PATH ? 'VLC_PATH does not point to an executable VLC binary.'
        : 'VLC was not found. Install VLC 3 in /Applications or set VLC_PATH in .env.');
}

function toVlcVolume(percent) {
    return Math.round(Math.min(200, Math.max(0, percent)) * 256 / 100);
}

class VlcPlayer extends EventEmitter {
    constructor({ spawnProcess = spawn, executable = findVlc, extraArgs = [] } = {}) {
        super();
        this.spawnProcess = spawnProcess;
        this.executable = executable;
        this.extraArgs = extraArgs;
        this.volume = 100;
        this.status = 'Stopped';
        this.track = null;
        this.error = '';
        this.session = null;
        this.request = 0;
    }

    update(status, error = '') {
        this.status = status;
        this.error = error;
        this.emit('change');
    }

    async play(source, track) {
        const request = ++this.request;
        await this.closeSession();
        if (request !== this.request) return;

        let child;
        try {
            child = this.spawnProcess(this.executable(), [
                '--ignore-config', '-I', 'oldrc', '--rc-fake-tty', '--no-media-library',
                '--no-video', '--play-and-exit', '--no-volume-save',
                ...(process.platform === 'darwin' ? ['--auhal-volume=' + toVlcVolume(this.volume)] : []),
                ...this.extraArgs, '--', source
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (error) {
            this.track = null;
            this.update('Stopped', error.message);
            return;
        }

        const session = { child, closing: false, started: false, pendingPause: false };
        this.session = session;
        this.track = track;
        let failure = '';
        let output = '';
        let diagnostics = '';
        const startup = setTimeout(() => {
            failure = 'VLC timed out opening the track.';
            void this.closeSession();
        }, 20000);
        // oldrc may buffer state notifications until it processes a command.
        const statusPoll = setInterval(() => {
            if (!session.started || session.pendingPause) this.send('status');
        }, 250);

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            if (session.closing) return;
            const lines = (output + chunk).split('\n');
            output = lines.pop().slice(-4096);
            for (const line of lines) {
                const state = line.match(/^status change: \( (play state: 3|pause state: 4) \)/);
                if (!state) continue;
                if (!session.started) {
                    session.started = true;
                    clearTimeout(startup);
                    this.send('volume ' + toVlcVolume(this.volume));
                }
                const status = state[1] === 'pause state: 4' ? 'Paused' : 'Playing';
                if (status !== this.status) {
                    session.pendingPause = false;
                    this.update(status);
                }
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => {
            if (session.closing) return;
            diagnostics = (diagnostics + chunk).slice(-4096);
            if (/failed to create audio output|module not functional/i.test(diagnostics)) {
                failure = 'VLC could not open an audio output device.';
            } else if (/your input can.t be opened|cannot open (?:the )?mrl|http[^\n]*error: HTTP/i.test(diagnostics)) {
                failure = 'VLC could not open this track.';
            }
            if (failure) void this.closeSession();
        });
        child.stdin.on('error', () => {
            if (session.closing) return;
            failure = 'VLC stopped responding to controls.';
            void this.closeSession();
        });
        child.on('error', error => {
            failure = 'Could not run VLC. Check VLC_PATH and your installation (' + error.code + ').';
        });
        session.closed = new Promise(done => child.once('close', code => {
            clearTimeout(startup);
            clearInterval(statusPoll);
            clearTimeout(session.killTimer);
            this.session = null;
            this.track = null;
            this.update('Stopped', failure || (!session.closing && (!session.started || code !== 0)
                ? 'VLC could not play this track.' : ''));
            done();
        }));
        this.update('Starting');
    }

    send(command) {
        const session = this.session;
        if (!session || session.closing || session.child.exitCode !== null || !session.child.stdin.writable) {
            return false;
        }
        session.child.stdin.write(command + '\n');
        return true;
    }

    togglePause() {
        const session = this.session;
        if (session?.started && !session.pendingPause) {
            session.pendingPause = this.send('pause');
        }
    }

    setVolume(percent) {
        this.volume = Math.min(200, Math.max(0, percent));
        if (this.session?.started) this.send('volume ' + toVlcVolume(this.volume));
        this.emit('change');
    }

    async closeSession() {
        const session = this.session;
        if (!session) return;
        if (!session.closing) {
            this.send('quit');
            session.closing = true;
            session.child.kill('SIGTERM');
            session.killTimer = setTimeout(() => session.child.kill('SIGKILL'), 1000);
        }
        await session.closed;
    }

    async stop() {
        ++this.request;
        await this.closeSession();
        if (!this.session && this.error) this.update('Stopped');
    }
}

module.exports = { VlcPlayer, findVlc, toVlcVolume };
