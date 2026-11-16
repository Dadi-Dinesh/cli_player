#!/bin/zsh -l

cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22)' 2>/dev/null; then
    print -u2 "CHILL AVVU MAMA needs Node.js 22 or newer."
    print -u2 "Install it from https://nodejs.org/ and open this launcher again."
    if [[ -t 0 ]]; then
        read -r '?Press Enter to close. '
    fi
    exit 1
fi

exec node start.js
