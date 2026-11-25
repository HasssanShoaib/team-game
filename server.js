// =============================================================================
// NPT Solution Architecture Chapter - Royale — zero-dependency relay server  v1.5
// Run:  node server.js        (Node 18+)   ->  http://localhost:3000
// Transports: WebSocket (/ws) with an automatic HTTP long-poll fallback (/rt/*)
// for networks/proxies that open WebSockets but block their traffic.
// The room HOST's browser runs the simulation; this server only routes messages.
// =============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const VERSION = '1.5';
const GAME_NAME = 'NPT Solution Architecture Chapter - Royale';
const MAX_PEERS = 19;                  // + host = 20 people per room
const rooms = new Map();
const clients = new Map();             // id -> client (both transports)
let seq = 1;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const onlineCount = () => [...clients.values()].filter(c => c.ready).length;

function newClient(kind) {
  const c = { id: 'p' + (seq++).toString(36) + crypto.randomBytes(2).toString('hex'), kind, room: null, open: true,
    ready: false, created: Date.now(), lastIn: Date.now(), q: [], pending: null, pendT: null, flushT: null };
  clients.set(c.id, c);
  return c;
}
// A client only counts as a player once a real message has made it through ('hello')
function markReady(c) {
  if (c.ready) return;
  c.ready = true;
  log(`✔ player online via ${c.kind === 'ws' ? 'WebSocket' : 'HTTP fallback'} (${onlineCount()} online)`);
}

// ---------- outbound ----------
function out(c, str) {
  if (!c.open) return;
  if (c.kind === 'ws') return frame(c, 0x1, Buffer.from(str));
  c.q.push(str);
  if (c.q.length > 600) c.q.splice(0, c.q.length - 600);
  if (c.pending && !c.flushT) c.flushT = setImmediate(() => { c.flushT = null; flushPoll(c); });
}
const send = (c, obj) => out(c, JSON.stringify(obj));
function flushPoll(c) {
  const res = c.pending; if (!res) return;
  c.pending = null; clearTimeout(c.pendT);
  const body = '[' + c.q.splice(0).join(',') + ']';
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise(r => { let d = ''; req.on('data', x => { d += x; if (d.length > 2e6) req.destroy(); }); req.on('end', () => r(d)); });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (p === '/' || p === '/index.html') {
    const f = path.join(__dirname, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(500); return res.end('index.html is missing next to server.js'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(f).pipe(res);
  }
  if (p === '/health') return json(res, 200, { ok: true, ringRoyale: true, game: GAME_NAME, version: VERSION, rooms: rooms.size, players: onlineCount() });

  // --- HTTP fallback transport ---
  if (p === '/rt/open' && req.method === 'POST') { const c = newClient('http'); return json(res, 200, { cid: c.id }); }
  if (p === '/rt/poll') {
    const c = clients.get(url.searchParams.get('cid'));
    if (!c || c.kind !== 'http' || !c.open) return json(res, 410, { error: 'gone' });
    c.lastIn = Date.now();
    if (c.pending) flushPoll(c);
    c.pending = res;
    if (c.q.length) return flushPoll(c);
    c.pendT = setTimeout(() => { if (c.pending === res) flushPoll(c); }, 20000);
    req.on('close', () => { if (c.pending === res) { c.pending = null; clearTimeout(c.pendT); } });
    return;
  }
  if (p === '/rt/send' && req.method === 'POST') {
    const c = clients.get(url.searchParams.get('cid'));
    if (!c || c.kind !== 'http' || !c.open) return json(res, 410, { error: 'gone' });
    c.lastIn = Date.now();
    let arr; try { arr = JSON.parse(await readBody(req)); } catch (_) { arr = null; }
    if (Array.isArray(arr)) for (const m of arr) { try { handle(c, m); } catch (e) { console.error('handle error', e); } }
    return json(res, 200, { ok: true });
  }
  res.writeHead(404); res.end('Not found');
});

// ---------- Minimal RFC 6455 WebSocket ----------
server.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = newClient('ws'); c.socket = socket; c.buf = Buffer.alloc(0); c.frag = null;
  socket.on('data', d => onData(c, d));
  socket.on('close', () => drop(c));
  socket.on('error', () => drop(c));
});
function frame(c, op, data) {
  if (!c.open || !c.socket) return;
  const len = data.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  try { c.socket.write(Buffer.concat([h, data])); } catch (_) {}
}
function onData(c, chunk) {
  c.buf = Buffer.concat([c.buf, chunk]);
  while (c.buf.length >= 2) {
    const fin = c.buf[0] & 0x80, op = c.buf[0] & 0x0f, masked = c.buf[1] & 0x80;
    let len = c.buf[1] & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > 2e6) return drop(c, 'oversized frame');
    const mk = masked ? 4 : 0;
    if (c.buf.length < off + mk + len) return;
    let payload = Buffer.from(c.buf.subarray(off + mk, off + mk + len));
    if (masked) { const m = c.buf.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
    c.buf = c.buf.subarray(off + mk + len);
    c.lastIn = Date.now();
    if (op === 0x8) { frame(c, 0x8, Buffer.alloc(0)); return drop(c); }
    if (op === 0x9) { frame(c, 0xA, payload); continue; }
    if (op === 0xA) continue;
    if (op === 0x1 && !fin) { c.frag = [payload]; continue; }
    if (op === 0x0) { if (!c.frag) continue; c.frag.push(payload); if (!fin) continue; payload = Buffer.concat(c.frag); c.frag = null; }
    else if (op !== 0x1) continue;
    let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (_) { continue; }
    try { handle(c, msg); } catch (e) { console.error('handle error', e); }
  }
}

// ---------- Room routing ----------
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s;
  do { s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(s));
  return s;
}
function handle(c, m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello': markReady(c); send(c, { t: 'hello', v: VERSION, via: c.kind }); break;
    case 'ping': break;
    case 'create': {
      markReady(c); leave(c);
      const room = { code: genCode(), host: c, peers: new Map() };
      rooms.set(room.code, room); c.room = room;
      send(c, { t: 'created', code: room.code, id: c.id });
      log(`✔ Room ${room.code} created`);
      break;
    }
    case 'join': {
      markReady(c); leave(c);
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(c, { t: 'err', msg: `Room ${code} not found. Check the code (rooms close when the host leaves or the server restarts).` });
      if (room.peers.size >= MAX_PEERS) return send(c, { t: 'err', msg: 'That room is full.' });
      room.peers.set(c.id, c); c.room = room;
      send(c, { t: 'joined', code: room.code, id: c.id });
      send(room.host, { t: 'peerJoin', id: c.id, name: String(m.name || 'Pilot').slice(0, 16), color: String(m.color || '#22d3ee').slice(0, 9) });
      log(`✔ ${m.name} joined ${room.code}`);
      break;
    }
    case 'th': if (c.room && c.room.host !== c) send(c.room.host, { t: 'fromPeer', from: c.id, d: m.d }); break;
    case 'bc': if (c.room && c.room.host === c) { const s = JSON.stringify({ t: 'fromHost', d: m.d }); for (const p of c.room.peers.values()) out(p, s); } break;
    case 'tp': if (c.room && c.room.host === c) { const p = c.room.peers.get(m.to); if (p) send(p, { t: 'fromHost', d: m.d }); } break;
    case 'leave': leave(c); break;
  }
}
function leave(c) {
  const room = c.room; if (!room) return;
  c.room = null;
  if (room.host === c) {
    for (const p of room.peers.values()) { p.room = null; send(p, { t: 'hostLeft' }); }
    rooms.delete(room.code);
    log(`✖ Room ${room.code} closed`);
  } else { room.peers.delete(c.id); send(room.host, { t: 'peerLeave', id: c.id }); }
}
function drop(c, why) {
  if (!c.open) return;
  leave(c); c.open = false; clients.delete(c.id);
  if (c.socket) { try { c.socket.destroy(); } catch (_) {} }
  if (c.pending) { try { c.pending.writeHead(410); c.pending.end(); } catch (_) {} c.pending = null; }
  clearTimeout(c.pendT);
  if (c.ready) log(`↔ player offline${why ? ' (' + why + ')' : ''} (${onlineCount()} online)`);
  else if (c.kind === 'ws' && why === 'no-traffic') log('… a WebSocket opened but no messages got through (proxy?) — that browser will use the HTTP fallback');
}

// ---------- Housekeeping ----------
setInterval(() => {
  const now = Date.now();
  for (const c of [...clients.values()]) {
    if (c.kind === 'ws') {
      if (!c.ready && now - c.created > 10000) drop(c, 'no-traffic');
      else if (now - c.lastIn > 45000) drop(c, 'timed out');
      else frame(c, 0x9, Buffer.alloc(0));
    } else if (!c.pending && now - c.lastIn > 15000) drop(c, 'timed out');
  }
}, 5000);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Port ${PORT} is already in use — probably an older server (e.g. the quiz game) is still running.`);
    console.error(`    Stop it with Ctrl+C in its terminal (or run: pkill -f "node server.js"), then start this one again.`);
    console.error(`    Or use another port:  PORT=3001 node server.js\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⭕ ${GAME_NAME} — server v${VERSION} running on http://localhost:${PORT}`);
  console.log(`  Health check: /health   |   Fast test mode: /?fast   |   Force HTTP transport: /?transport=http\n`);
});
