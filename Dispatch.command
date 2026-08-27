#!/bin/bash
# Dispatch launcher — double-click to start the app and open it in your browser.
# Lives in the project root; keep it here (make a Finder alias if you want it on
# the Desktop or Dock, so it still finds the project).

URL="http://localhost:3000"

# Run from the project directory this file lives in.
cd "$(dirname "$0")" || exit 1

# --- Ensure the Android emulator is up (OfferUp/Facebook automation needs it) ---
# It's a heavy VM that holds your logged-in apps, so start it ONLY if it isn't
# already running — never cold-restart a live one. Absolute SDK paths because a
# double-clicked .command doesn't get your shell's PATH.
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
EMULATOR="$HOME/Library/Android/sdk/emulator/emulator"
AVD="dispatch_offerup"
[ -x "$ADB" ] || ADB="$(command -v adb)"
[ -x "$EMULATOR" ] || EMULATOR="$(command -v emulator)"
if [ -x "$ADB" ] && [ -x "$EMULATOR" ]; then
  if "$ADB" devices 2>/dev/null | grep -q "^emulator-.*device$"; then
    echo "Android emulator already running."
  else
    echo "Starting the Android emulator ($AVD)…"
    "$EMULATOR" -avd "$AVD" >/dev/null 2>&1 &
  fi
else
  echo "⚠️  Android SDK not found — skipping emulator (OfferUp/Facebook automation won't work)."
fi

# Build when there's no valid PRODUCTION build, or when the code changed since the
# last one. A bare .next left by `next dev` isn't a production build — only a real
# `next build` writes .next/BUILD_ID — so checking the directory alone isn't enough
# (that gap caused a "Could not find a production build" failure once).
needs_build() {
  [ ! -f ".next/BUILD_ID" ] && return 0                                        # no prod build
  [ -n "$(find src package.json next.config.ts -newer .next/BUILD_ID 2>/dev/null | head -1)" ] && return 0  # code changed since build
  return 1
}

# Already running? Normally just open the browser. BUT if the code changed since the
# running server's build, that server is serving a STALE build — the recurring "why
# does it still show the old version" trap (a relaunch after a merge re-opens the old
# server without rebuilding). Detect it and offer to rebuild+restart instead of
# silently opening stale.
if curl -s -o /dev/null "$URL"; then
  if needs_build; then
    echo "⚠️  Dispatch is already running, but your code changed since its last build."
    echo "    The open app is serving a STALE build — you won't see your latest changes."
    printf "    Rebuild and restart now? [y/N] "
    read -r reply
    if [ "$reply" = "y" ] || [ "$reply" = "Y" ]; then
      echo "Stopping the old server…"
      lsof -ti tcp:3000 2>/dev/null | xargs kill 2>/dev/null
      for _ in $(seq 1 10); do curl -s -o /dev/null "$URL" || break; sleep 0.5; done  # wait for the port to free
      # fall through to the build + start below
    else
      echo "Opening the current (stale) build at $URL."
      open "$URL"
      exit 0
    fi
  else
    echo "Dispatch is already running. Opening $URL"
    open "$URL"
    exit 0
  fi
fi
if needs_build; then
  echo "Building Dispatch (about 30 seconds)…"
  npm run build || { echo "Build failed. Press any key to close."; read -n 1; exit 1; }
fi

echo "Starting Dispatch…"
npm start &
SERVER_PID=$!

# Stop the server cleanly on Ctrl+C or window close.
trap 'kill $SERVER_PID 2>/dev/null; exit 0' INT TERM

# Wait for the server to answer (up to ~20s), then open the browser.
for _ in $(seq 1 40); do
  curl -s -o /dev/null "$URL" && break
  sleep 0.5
done
open "$URL"

echo ""
echo "  Dispatch is running at $URL"
echo "  Leave this window open while you use it."
echo "  To stop Dispatch: press Ctrl+C, or just close this window."
echo ""

wait $SERVER_PID
