# 🚨 Incident Commander – Live Team Simulation (v2)

A multiplayer crisis simulation for virtual team meetings. The host screen-shares the game while players join from their own devices and decide how to handle 8 launch-week crises. Their combined choices move four shared team metrics, and each player scores points for good calls, speed and streaks.

## Run
    node server.js                    # Node 18+, no npm install needed
    ROUND_SECONDS=15 node server.js   # shorter rounds for testing

Open http://localhost:3000, or the forwarded URL in Codespaces, and click **Create room**.

## Codespaces tips
- Open the forwarded URL in a **normal browser tab**, not the VS Code Simple Browser.
- Check the server is reachable: `<url>/health` should show `{"ok":true,...}`.
- The terminal logs each request (e.g. `POST /api/create` and `✔ Room ABCDE created`).
- If the room isn't created, the page now shows an error message explaining why.
- To let teammates join: Ports tab → port 3000 → Port Visibility → Organization or Public.

## Customise
Edit the `SCENARIOS` array at the top of `server.js`.
