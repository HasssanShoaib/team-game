# NPT Solution Architecture Chapter - Royale (v1.5)

2D top-down multiplayer battle royale for team sessions. No dependencies.

## Run
    node server.js        # Node 18+  ->  http://localhost:3000
`/health` should show `"version":"1.5"`.

## Deploy on Render
Web Service · Build command: `npm install` (or empty) · Start command: `npm start` · Free plan.
`package.json`, `server.js` and `index.html` must be in the repo root (or set Root Directory).

## Match timing (configurable)
- **In the lobby** the host sets *Battle phase* (5–300 s) and *Ring closing* (10–300 s), or picks a preset:
  Quick 20/30 · Standard 30/50 · Long 60/90 · Epic 90/120. Players see the host's settings live.
- **By link**: `/?battle=60&ring=90` pre-fills the host's timing.
- The host's last choice is remembered in that browser.
- `/?fast` = 8 s / 14 s defaults for quick testing.

## Room size
Up to 20 fighters (people + AI bots). The arena grows with the number of fighters.

## Look
Safe zone = glowing red ring; everything outside the ring = light grey (takes 10 HP/s once the ring starts closing).
Colours can be tuned in `CONFIG` (`RING_COLOR`, `RING_GLOW`, `OUTSIDE_FILL`, `OUTSIDE_ALPHA`).

## Controls
WASD/Arrows move · Mouse aim · Click/Space fire · M mute · Q/E change spectated player · Mobile: two on-screen sticks
