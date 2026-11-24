# 🚨 Incident Commander – Live Team Simulation

A multiplayer crisis simulation for virtual team meetings. The host screen-shares the game while players join from their own laptop or phone and make decisions through 8 launch-week crises. Their combined choices drive four shared team metrics (Uptime, Trust, Budget, Morale), and each player scores points for good calls, speed and streaks.

## Run it (2 minutes)
1. Install Node.js 18+ (no other dependencies).
2. In this folder run:  `node server.js`
   - Optional: `ROUND_SECONDS=60 node server.js` (default is 45s; on Windows PowerShell use `$env:ROUND_SECONDS=60; node server.js`)
3. Open http://localhost:3000 and click **Create room**.

## Let teammates join remotely
Teammates need to be able to reach your machine. Choose one option:
- **VS Code port forwarding**: open the Ports panel, forward port 3000 and set visibility to *Private* (requires a GitHub/Microsoft sign-in) or *Public*, then share the URL.
- **Dev Tunnels CLI**: `devtunnel host -p 3000 --allow-anonymous`
- **Azure App Service / container**: deploy the folder as a Node app (`npm start` isn't needed; the start command is `node server.js`).
> Check your organisation's policy before exposing a tunnel. No company data is used, and game state lives only in memory.

## Facilitating (~20 minutes)
1. **Lobby**: share the invite link or room code in the Teams chat.
2. **Each round**: players get 45s. The round ends early once everyone has answered, or you can click *Reveal now*.
3. **Reveal**: discuss the vote split and the 💡 lesson (spend 1–2 minutes here, because this is where the conversation happens).
4. **Final screen**: podium and team health verdict. Use the "lowest agreement" round as a retro prompt.

## Customise
Edit the `SCENARIOS` array at the top of `server.js` (title, text, 4 options with effects and points, lesson). Option order is shuffled for each game.
