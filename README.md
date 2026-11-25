# ⭕ Ring Royale — 2D Neon Battle Royale (v1.1)

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
