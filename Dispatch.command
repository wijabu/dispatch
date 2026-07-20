#!/bin/bash
# Dispatch launcher — double-click to start the app and open it in your browser.
# Lives in the project root; keep it here (make a Finder alias if you want it on
# the Desktop or Dock, so it still finds the project).

URL="http://localhost:3000"

# Run from the project directory this file lives in.
cd "$(dirname "$0")" || exit 1

# Already running? Just open the browser and stop — don't start a second server.
if curl -s -o /dev/null "$URL"; then
  echo "Dispatch is already running. Opening $URL"
  open "$URL"
  exit 0
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
