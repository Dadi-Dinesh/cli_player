#!/bin/zsh -l

cd -- "${0:A:h}" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

for node_path in "${(@f)$(whence -pa node)}"; do
    if "$node_path" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
        exec "$node_path" start.js
    fi
done

print -u2 "CHILL AVVU MAMA needs Node.js 22 or newer."
print -u2 "Install it from https://nodejs.org/ and open this launcher again."
if [[ -t 0 ]]; then
    read -r '?Press Enter to close. '
fi
exit 1
