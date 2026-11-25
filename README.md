# ⭕ Ring Royale — 2D Neon Battle Royale (v1.4)

## Run
    node server.js            # Node 18+, no npm install
Open port 3000 in a normal browser tab (Codespaces: Ports tab → 🌐).
- `/?fast` — short rounds for testing · `/health` — must show "ringRoyale": true

## If "Create Room" makes an OFFLINE room
The menu shows the reason in yellow under the status line. Common causes:
| Message | Fix |
|---|---|
| Port 3000 is running a different server | The quiz server is still running. Ctrl+C it (or `pkill -f "node server.js"`), then `node server.js` in the Ring Royale folder |
| Cannot reach the server | Start `node server.js` |
| Redirected (sign-in) | Reload the page in a normal browser tab and sign in to GitHub |
| Live connection refused / timed out | WebSockets are blocked: use a normal Edge/Chrome tab, not the VS Code preview |

## Play with friends
Ports tab → port 3000 → Port Visibility → Organization. Then Create Room → Copy link → share the link.

## Controls
WASD/Arrows move · Mouse aim · Click/Space fire · M mute · Q/E switch who you're spectating · Mobile: two on-screen sticks

## Connection modes (v1.4)
The menu badge shows how you're connected:
- **ONLINE · WS**: WebSocket (fastest)
- **ONLINE · HTTP**: proxy-safe fallback, used automatically when a network or proxy blocks WebSocket traffic
You can force the fallback with `/?transport=http`. The server log only counts real players ("✔ player online via …").

## Room size (v1.4)
- Up to **20 fighters per room** (people + AI bots). If a person joins a full room, a bot is dropped to make space.
- The arena grows with the number of fighters: 1100 for up to 8, growing to 1650 for 20.
