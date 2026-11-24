// Incident Commander - live multiplayer team simulation
// Zero dependencies. Run:  node server.js   (Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROUND_SECONDS = parseInt(process.env.ROUND_SECONDS || '45', 10);
const METRICS = ['uptime', 'trust', 'budget', 'morale'];

// ---------------- Scenarios ----------------
// e = effect on team metrics, p = points (0-100) for the individual
const SCENARIOS = [
  {
    time: 'Mon 08:55', title: 'Launch-day latency spike',
    text: 'Release 4.2 went live 10 minutes ago. API latency is up 300% and customer complaints are starting to roll in.',
    options: [
      { t: 'Roll back to the last known-good release', e: { uptime: 12, trust: 5, morale: -3 }, p: 100 },
      { t: 'Hot-fix forward directly in production', e: { uptime: -10, trust: -5, morale: -5 }, p: 30 },
      { t: 'Scale out the infrastructure and hope it absorbs the load', e: { uptime: 4, budget: -15 }, p: 55 },
      { t: 'Wait 30 minutes to see if it settles', e: { uptime: -15, trust: -10 }, p: 0 }
    ],
    lesson: 'Restore service first, then diagnose. A rehearsed rollback is the fastest way to reduce customer impact.'
  },
  {
    time: 'Mon 09:20', title: 'The executive ping',
    text: 'An executive wants a status update in 5 minutes. You don\'t know the root cause yet.',
    options: [
      { t: 'Send an update covering what we know, what we don\'t know and when the next update is', e: { trust: 12 }, p: 100 },
      { t: 'Hold off until the root cause is confirmed', e: { trust: -10 }, p: 20 },
      { t: '"Minor blip, all resolved" 👍', e: { trust: -20 }, p: 0 },
      { t: 'Invite the exec to join the incident bridge', e: { trust: 2, morale: -6 }, p: 40 }
    ],
    lesson: 'Regular, honest updates build trust, even when the update is "we don\'t know yet".'
  },
  {
    time: 'Mon 14:00', title: 'Root cause found',
    text: 'A config flag changed by a senior engineer caused the outage. Leadership asks, "Who did this?"',
    options: [
      { t: 'Run a blameless post-incident review focused on the system', e: { morale: 12, trust: 5 }, p: 100 },
      { t: 'Add automated config validation to the pipeline', e: { uptime: 8, budget: -5 }, p: 80 },
      { t: 'Name the engineer in the incident report', e: { morale: -18 }, p: 0 },
      { t: 'Restrict production config access to managers only', e: { morale: -10, uptime: 2 }, p: 20 }
    ],
    lesson: 'Blame doesn\'t make people more careful, it just makes them hide things. Fix the system and the guardrails.'
  },
  {
    time: 'Tue 10:30', title: 'The shiny AI tool',
    text: 'A vendor offers an AIOps platform at a 40% discount, but only if you sign today.',
    options: [
      { t: 'Ask for a 2-week PoC with clear success criteria', e: { budget: 2, trust: 4 }, p: 100 },
      { t: 'Sign now, because 40% off is 40% off', e: { budget: -15 }, p: 25 },
      { t: 'Reject it, since we don\'t trust vendors', e: { morale: -2 }, p: 40 },
      { t: 'Ask the team to build our own in this sprint', e: { morale: -10, budget: -8 }, p: 10 }
    ],
    lesson: 'Artificial urgency is a sales tactic. Decide on evidence, with success criteria agreed up front.'
  },
  {
    time: 'Wed 16:45', title: 'Scope creep at 4:45pm',
    text: 'The Product Owner wants an untested feature added to tomorrow\'s release because "the customer was promised".',
    options: [
      { t: 'Ship it dark behind a feature flag and enable it after testing', e: { trust: 8, uptime: 2 }, p: 100 },
      { t: 'Accept it and ship it as-is', e: { uptime: -15, trust: 3 }, p: 15 },
      { t: 'Refuse outright', e: { trust: -10 }, p: 35 },
      { t: 'Delay the whole release by a week', e: { trust: -6, budget: -5 }, p: 50 }
    ],
    lesson: 'Separating deploy from release with feature flags lets you meet the promise without taking on the risk.'
  },
  {
    time: 'Thu 07:10', title: 'Running on empty',
    text: 'Two engineers have been paged three nights in a row. One just messaged: "I\'m fine 🙂".',
    options: [
      { t: 'Rotate the on-call roster and give them a recovery day', e: { morale: 15, budget: -4 }, p: 100 },
      { t: 'Bring in a contractor to cover', e: { morale: 4, budget: -15 }, p: 50 },
      { t: 'Order pizza for the team 🍕', e: { morale: 2 }, p: 25 },
      { t: 'Ask them to hang in there until Friday', e: { morale: -15, uptime: -4 }, p: 0 }
    ],
    lesson: 'Tired engineers cause incidents. Protecting recovery time is a reliability practice, not a perk.'
  },
  {
    time: 'Thu 13:15', title: 'Critical CVE drops',
    text: 'A critical vulnerability has been found in a library you use, and an exploit is already public.',
    options: [
      { t: 'Apply a WAF virtual patch now, then patch properly through an expedited change', e: { uptime: 4, trust: 10 }, p: 100 },
      { t: 'Patch and deploy through an expedited change with tests', e: { trust: 8, morale: -3 }, p: 90 },
      { t: 'Wait for the next release window', e: { trust: -18 }, p: 5 },
      { t: 'Take the service offline until it\'s patched', e: { uptime: -20, trust: -3 }, p: 30 }
    ],
    lesson: 'Layered mitigation buys you time without cutting corners on change control.'
  },
  {
    time: 'Fri 11:00', title: 'The cloud bill',
    text: 'Finance flags that cloud spend is 35% over budget this quarter.',
    options: [
      { t: 'Tag resources, right-size them and auto-stop non-prod overnight', e: { budget: 16, morale: 2 }, p: 100 },
      { t: 'Buy reserved instances for everything right away', e: { budget: 5 }, p: 45 },
      { t: 'Cut back monitoring and logging', e: { budget: 10, uptime: -12 }, p: 15 },
      { t: 'Ask Finance for more budget', e: { trust: -6 }, p: 25 }
    ],
    lesson: 'FinOps starts with visibility. You can\'t optimise what you haven\'t tagged.'
  }
];

// ---------------- State ----------------
const rooms = {};
const id = (n = 8) => crypto.randomBytes(n).toString('hex');
const code = () => { let c; do { c = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms[c]); return c; };
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));

function shuffledOrder(n) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function newRoom() {
  const c = code();
  rooms[c] = {
    code: c, hostKey: id(12), players: {}, phase: 'lobby', round: -1,
    deadline: 0, answers: {}, metrics: { uptime: 60, trust: 60, budget: 60, morale: 60 },
    lastReveal: null, clients: new Set(), timer: null, history: [], orders: SCENARIOS.map(s => shuffledOrder(s.options.length)), created: Date.now()
  };
  return rooms[c];
}

function scenarioView(room) {
  if (room.round < 0 || room.round >= SCENARIOS.length) return null;
  const s = SCENARIOS[room.round];
  const order = room.orders[room.round];
  return { time: s.time, title: s.title, text: s.text, options: order.map(i => s.options[i].t) };
}

function leaderboard(room) {
  return Object.values(room.players).sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score, answered: room.answers[p.id] !== undefined, streak: p.streak }));
}

function view(room, client) {
  const base = {
    code: room.code, phase: room.phase, round: room.round, totalRounds: SCENARIOS.length,
    deadline: room.deadline, now: Date.now(), roundSeconds: ROUND_SECONDS,
    metrics: room.metrics, players: leaderboard(room),
    answeredCount: Object.keys(room.answers).length, playerCount: Object.keys(room.players).length,
    scenario: room.phase === 'lobby' ? null : scenarioView(room),
    reveal: room.phase === 'reveal' || room.phase === 'end' ? room.lastReveal : null,
    history: room.phase === 'end' ? room.history : null
  };
  if (client.role === 'host') base.role = 'host';
  else {
    const p = room.players[client.pid];
    base.role = 'player';
    base.you = p ? { name: p.name, score: p.score, choice: room.answers[p.id] ? room.answers[p.id].choice : null, last: p.last, rank: leaderboard(room).findIndex(x => x.name === p.name) + 1 } : null;
  }
  return base;
}

function broadcast(room) {
  for (const c of room.clients) {
    try { c.res.write(`data: ${JSON.stringify(view(room, c))}\n\n`); } catch (e) { room.clients.delete(c); }
  }
}

function startRound(room) {
  room.round += 1;
  if (room.round >= SCENARIOS.length) return endGame(room);
  room.phase = 'question'; room.answers = {};
  room.deadline = Date.now() + ROUND_SECONDS * 1000;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => reveal(room), ROUND_SECONDS * 1000 + 300);
  broadcast(room);
}

function reveal(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  const s = SCENARIOS[room.round];
  const order = room.orders[room.round];
  const counts = order.map(() => 0);
  const delta = { uptime: 0, trust: 0, budget: 0, morale: 0 };
  const ans = Object.entries(room.answers);
  for (const [pid, a] of ans) {
    counts[a.choice]++;
    const opt = s.options[order[a.choice]];
    METRICS.forEach(m => delta[m] += (opt.e[m] || 0) / ans.length);
    const p = room.players[pid];
    if (!p) continue;
    const remaining = Math.max(0, room.deadline - a.at) / (ROUND_SECONDS * 1000);
    const speed = opt.p >= 80 ? Math.round(50 * remaining) : 0;
    p.streak = opt.p >= 80 ? (p.streak || 0) + 1 : 0;
    const streakBonus = p.streak >= 3 ? 25 : 0;
    const pts = opt.p + speed + streakBonus;
    p.score += pts;
    p.last = { pts, base: opt.p, speed, streakBonus, round: room.round };
  }
  // Players who did not answer
  for (const p of Object.values(room.players)) {
    if (!room.answers[p.id]) { p.streak = 0; p.last = { pts: 0, base: 0, speed: 0, streakBonus: 0, round: room.round, missed: true }; }
  }
  if (ans.length === 0) METRICS.forEach(m => delta[m] = -6); // No decision is a decision
  METRICS.forEach(m => { delta[m] = Math.round(delta[m]); room.metrics[m] = clamp(room.metrics[m] + delta[m]); });
  const bestIdx = order.indexOf(s.options.reduce((bi, o, i, arr) => o.p > arr[bi].p ? i : bi, 0));
  room.lastReveal = {
    counts, best: bestIdx, delta, lesson: s.lesson, noAnswers: ans.length === 0,
    optionPoints: order.map(i => s.options[i].p),
    optionEffects: order.map(i => s.options[i].e)
  };
  room.history.push({ title: s.title, delta, consensus: ans.length ? Math.round(100 * Math.max(...counts) / ans.length) : 0 });
  room.phase = 'reveal';
  broadcast(room);
}

function endGame(room) {
  clearTimeout(room.timer);
  room.phase = 'end';
  room.round = SCENARIOS.length - 1;
  broadcast(room);
}

// ---------------- HTTP ----------------
function body(req) {
  return new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }

  if (req.method === 'GET' && p === '/events') {
    const room = rooms[(url.searchParams.get('room') || '').toUpperCase()];
    if (!room) return json(res, 404, { error: 'Room not found' });
    const hk = url.searchParams.get('hostKey'); const pid = url.searchParams.get('pid');
    let client;
    if (hk && hk === room.hostKey) client = { role: 'host', res };
    else if (pid && room.players[pid]) client = { role: 'player', pid, res };
    else return json(res, 403, { error: 'Not authorised' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    room.clients.add(client);
    res.write(`data: ${JSON.stringify(view(room, client))}\n\n`);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 20000);
    req.on('close', () => { clearInterval(ping); room.clients.delete(client); });
    return;
  }

  if (req.method === 'POST' && p === '/api/create') {
    const room = newRoom();
    return json(res, 200, { room: room.code, hostKey: room.hostKey });
  }

  if (req.method === 'POST' && p === '/api/join') {
    const b = await body(req);
    const room = rooms[(b.room || '').toUpperCase().trim()];
    if (!room) return json(res, 404, { error: 'Room code not found. Check it with your host.' });
    const name = String(b.name || '').trim().slice(0, 24);
    if (!name) return json(res, 400, { error: 'Please enter your name.' });
    const existing = Object.values(room.players).find(x => x.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (b.pid === existing.id) return json(res, 200, { pid: existing.id, room: room.code });
      return json(res, 409, { error: 'That name is taken in this room. Try adding an initial.' });
    }
    if (room.phase === 'end') return json(res, 400, { error: 'This game has finished.' });
    const pid = id();
    room.players[pid] = { id: pid, name, score: 0, streak: 0, last: null };
    broadcast(room);
    return json(res, 200, { pid, room: room.code });
  }

  if (req.method === 'POST' && p === '/api/answer') {
    const b = await body(req);
    const room = rooms[(b.room || '').toUpperCase()];
    if (!room || !room.players[b.pid]) return json(res, 404, { error: 'Not in room' });
    if (room.phase !== 'question' || Date.now() > room.deadline) return json(res, 400, { error: 'Round closed' });
    if (room.answers[b.pid]) return json(res, 400, { error: 'Already answered' });
    const c = parseInt(b.choice, 10);
    if (!(c >= 0 && c < SCENARIOS[room.round].options.length)) return json(res, 400, { error: 'Bad choice' });
    room.answers[b.pid] = { choice: c, at: Date.now() };
    if (Object.keys(room.answers).length >= Object.keys(room.players).length) reveal(room);
    else broadcast(room);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/host') {
    const b = await body(req);
    const room = rooms[(b.room || '').toUpperCase()];
    if (!room || b.hostKey !== room.hostKey) return json(res, 403, { error: 'Not host' });
    if (b.action === 'start' && room.phase === 'lobby') startRound(room);
    else if (b.action === 'reveal' && room.phase === 'question') reveal(room);
    else if (b.action === 'next' && room.phase === 'reveal') startRound(room);
    else if (b.action === 'end') endGame(room);
    else if (b.action === 'kick' && room.players[b.pid]) { delete room.players[b.pid]; broadcast(room); }
    return json(res, 200, { ok: true });
  }

  res.writeHead(404); res.end('Not found');
});

// Clean up rooms older than 12h
setInterval(() => { const cut = Date.now() - 12 * 3600e3; for (const c in rooms) if (rooms[c].created < cut) { clearTimeout(rooms[c].timer); delete rooms[c]; } }, 3600e3);

server.listen(PORT, () => {
  console.log(`\n  🚨 Incident Commander is running on http://localhost:${PORT}`);
  console.log(`  Round length: ${ROUND_SECONDS}s  |  Scenarios: ${SCENARIOS.length}\n`);
});
