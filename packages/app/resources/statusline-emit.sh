#!/bin/sh
# AirLock Claude quota statusLine emitter -- PURE SHELL, intentionally NOT node.
#
# Claude Code pipes the statusLine JSON on stdin and uses this command's stdout as
# the footer. We (1) siphon: atomically write the raw payload to a side-channel
# file AirLock's main process watches + parses, and (2) chain: re-feed the SAME
# payload to any pre-existing user statusLine and pass its stdout through, so the
# user's footer is untouched.
#
# Why shell and not node: Claude Code's statusLine spawn crashes ANY Node program
# at bootstrap on some machines -- a Node Utf8Value/MaybeStackBuffer capacity
# assertion reached during early bootstrap (reproduced with a trivial `node -e`,
# real node, and Electron-as-node; diagnosed 2026-06-16). `/bin/sh` runs fine, so
# a shell statusLine sidesteps the whole class. See the spec / install.ts comment.
#
# Config (OUT = side-channel path, PRIOR = prior statusLine command to chain) is a
# shell-sourceable file written by install.ts; its path is argv[1].

OUT=""
PRIOR=""
[ -n "$1" ] && [ -f "$1" ] && . "$1"

# No/!invalid config: consume stdin so Claude Code's pipe never blocks, then exit
# cleanly (never break the footer).
[ -z "$OUT" ] && { cat >/dev/null 2>&1; exit 0; }

# (1) Siphon the full payload to the side-channel atomically. Done first and
# independent of any prior command, so the meter's data is never partial.
t="$OUT.$$.tmp"
cat > "$t" 2>/dev/null && mv -f "$t" "$OUT" 2>/dev/null

# (2) Chain a pre-existing user statusLine, feeding it the same payload; its
# stdout becomes the footer Claude Code shows. (A slow prior is bounded by Claude
# Code's own statusLine timeout.)
[ -n "$PRIOR" ] && sh -c "$PRIOR" < "$OUT"

exit 0
