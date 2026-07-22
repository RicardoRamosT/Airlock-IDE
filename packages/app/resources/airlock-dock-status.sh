#!/bin/sh
# AirLock dock-status hook emitter -- PURE SHELL, intentionally NOT node.
#
# Registered (opt-in) in ~/.claude/settings.json for UserPromptSubmit/Stop/
# Notification/SessionEnd. Claude Code pipes the hook JSON on stdin; we extract
# session_id and record this session's state to a per-session side-channel file
# AirLock's main process watches. This file belongs to AirLock and is safe to
# delete if AirLock is uninstalled.
#
# Why shell, not node: Claude Code's hook/statusLine spawn crashes ANY Node
# program at bootstrap on some machines (diagnosed 2026-06-16). /bin/sh is safe.
#
# argv: $1 = shell-sourceable config (DIR=<sessions dir>); $2 = state (working|done|gone)

DIR=""
LIVE=""
[ -n "$1" ] && [ -f "$1" ] && . "$1"
STATE="$2"

# Consume stdin so Claude Code's pipe never blocks, even if we bail early.
PAYLOAD=$(cat 2>/dev/null)

[ -z "$DIR" ] && exit 0

# Extract session_id from the JSON (first match), then keep only filename-safe
# chars. No jq assumed.
SID=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
SID=$(printf '%s' "$SID" | tr -cd 'A-Za-z0-9._-')
[ -z "$SID" ] && exit 0

F="$DIR/$SID"
if [ "$STATE" = "gone" ]; then
  rm -f "$F" 2>/dev/null
  # Also drop this session's liveness heartbeat (written by the quota emitter).
  [ -n "$LIVE" ] && rm -f "$LIVE/$SID" 2>/dev/null
else
  mkdir -p "$DIR" 2>/dev/null
  t="$F.$$.tmp"
  printf '%s %s\n' "$STATE" "$(date +%s)" > "$t" 2>/dev/null && mv -f "$t" "$F" 2>/dev/null
fi
exit 0
