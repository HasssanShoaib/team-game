# ⭕ Ring Royale — 2D Neon Battle Royale

Top-down multiplayer battle royale in one HTML file, plus a tiny relay server with no dependencies.

## Run (Codespaces or local)
    node server.js            # Node 18+, no npm install
Open the forwarded port 3000 (or http://localhost:3000).
- `/?fast` — 8s battle phase + 14s ring collapse (for testing)
- `/health` — server check

## Play with friends
1. Ports tab → port 3000 → **Port Visibility → Organization** (or Public).
2. Create Room → **Copy link** → share it. Friends paste the link or 4-letter code.
3. Host adds AI bots if needed → **Start Match**.

Opening `index.html` directly (file://) runs **offline mode** with Quick Solo and local bot rooms.

## Controls
| Desktop | Mobile |
|---|---|
| WASD / Arrows: move | Left stick: move |
| Mouse: aim, Click / Space: fire | Right stick: aim and fire |
| M: mute, Q / E: switch spectate target | |

## How it works
- The room **host's browser is authoritative**. It runs the bots, hits, zone damage and the win check, then broadcasts 20 Hz snapshots and events. Each client sends its own position and shots at 30 Hz.
- `server.js` only routes messages between players in a room. Rooms close when the host leaves.
- Tune gameplay in the `CONFIG` block at the top of the script (timers, damage, speeds, bot range).
