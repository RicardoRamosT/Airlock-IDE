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
DOCK_LIVE_DIR=""
[ -n "$1" ] && [ -f "$1" ] && . "$1"

# No/!invalid config: consume stdin so Claude Code's pipe never blocks, then exit
# cleanly (never break the footer).
[ -z "$OUT" ] && { cat >/dev/null 2>&1; exit 0; }

# (1) Siphon the full payload to the side-channel atomically. Done first and
# independent of any prior command, so the meter's data is never partial.
t="$OUT.$$.tmp"
cat > "$t" 2>/dev/null && mv -f "$t" "$OUT" 2>/dev/null

# (1b) Dock-status liveness heartbeat. Claude Code re-runs this statusLine every
# ~5s while a session is alive -- including during long model thinking and while
# waiting on a subagent, when NO hook fires -- so stamping a per-session file here
# lets AirLock's dock watcher know the session is still working. A NO-OP unless
# DOCK_LIVE_DIR is set AND exists; that dir exists only while the dock badge
# feature is enabled, so quota-only users are unaffected. session_id is read from
# the payload we just wrote to OUT (stdin is already consumed).
if [ -n "$DOCK_LIVE_DIR" ] && [ -d "$DOCK_LIVE_DIR" ]; then
  SID=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OUT" | head -1 | tr -cd 'A-Za-z0-9._-')
  if [ -n "$SID" ]; then
    lt="$DOCK_LIVE_DIR/$SID.$$.tmp"
    printf '%s\n' "$(date +%s)" > "$lt" 2>/dev/null && mv -f "$lt" "$DOCK_LIVE_DIR/$SID" 2>/dev/null
  fi
fi

# (2) Chain a pre-existing user statusLine, feeding it the same payload; its
# stdout becomes the footer Claude Code shows. (A slow prior is bounded by Claude
# Code's own statusLine timeout.)
[ -n "$PRIOR" ] && sh -c "$PRIOR" < "$OUT"

exit 0
