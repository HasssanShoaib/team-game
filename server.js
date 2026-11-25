// =============================================================================
// Ring Royale — zero-dependency relay server (HTTP + WebSocket)   v1.1
// Run:  node server.js        (Node 18+)   ->  http://localhost:3000
// Serves index.html and relays room messages. The room HOST's browser runs the
// simulation (host-authoritative); this server only routes messages.
// =============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const VERSION = '1.1';
const MAX_PEERS = 11;
const rooms = new Map();
const clients = new Set();
let seq = 1;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/' || p === '/index.html') {
    const f = path.join(__dirname, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(500); return res.end('index.html is missing next to server.js'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(f).pipe(res);
  }
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, ringRoyale: true, version: VERSION, rooms: rooms.size, clients: clients.size }));
  }
  res.writeHead(404); res.end('Not found');
});

// ---------- Minimal RFC 6455 WebSocket ----------
server.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) { log('✖ bad upgrade', req.url); return socket.destroy(); }
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { id: 'p' + (seq++).toString(36) + crypto.randomBytes(2).toString('hex'), socket, buf: Buffer.alloc(0), frag: null, room: null, open: true };
  clients.add(c);
  log(`↔ player connected (${clients.size} online)`);
  socket.on('data', d => onData(c, d));
  socket.on('close', () => drop(c));
  socket.on('error', () => drop(c));
});

function frame(c, op, data) {
  if (!c.open) return;
  const len = data.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  try { c.socket.write(Buffer.concat([h, data])); } catch (_) {}
}
const sendRaw = (c, str) => frame(c, 0x1, Buffer.from(str));
const send = (c, obj) => sendRaw(c, JSON.stringify(obj));

function onData(c, chunk) {
  c.buf = Buffer.concat([c.buf, chunk]);
  while (c.buf.length >= 2) {
    const fin = c.buf[0] & 0x80, op = c.buf[0] & 0x0f, masked = c.buf[1] & 0x80;
    let len = c.buf[1] & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > 1e6) return drop(c);
    const mk = masked ? 4 : 0;
    if (c.buf.length < off + mk + len) return;
    let payload = Buffer.from(c.buf.subarray(off + mk, off + mk + len));
    if (masked) { const m = c.buf.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
    c.buf = c.buf.subarray(off + mk + len);
    if (op === 0x8) { frame(c, 0x8, Buffer.alloc(0)); return drop(c); }
    if (op === 0x9) { frame(c, 0xA, payload); continue; }
    if (op === 0xA) continue;
    // Fragmented messages (some proxies split frames)
    if (op === 0x1 && !fin) { c.frag = [payload]; continue; }
    if (op === 0x0) {
      if (!c.frag) continue;
      c.frag.push(payload);
      if (!fin) continue;
      payload = Buffer.concat(c.frag); c.frag = null;
    } else if (op !== 0x1) continue;
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
  switch (m.t) {
    case 'hello': send(c, { t: 'hello', v: VERSION }); break;
    case 'create': {
      leave(c);
      const room = { code: genCode(), host: c, peers: new Map() };
      rooms.set(room.code, room); c.room = room;
      send(c, { t: 'created', code: room.code, id: c.id });
      log(`✔ Room ${room.code} created`);
      break;
    }
    case 'join': {
      leave(c);
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { log(`✖ join failed: room ${code} not found`); return send(c, { t: 'err', msg: `Room ${code} not found. Check the code (rooms close when the host leaves or the server restarts).` }); }
      if (room.peers.size >= MAX_PEERS) return send(c, { t: 'err', msg: 'That room is full.' });
      room.peers.set(c.id, c); c.room = room;
      send(c, { t: 'joined', code: room.code, id: c.id });
      send(room.host, { t: 'peerJoin', id: c.id, name: String(m.name || 'Pilot').slice(0, 16), color: String(m.color || '#22d3ee').slice(0, 9) });
      log(`✔ ${m.name} joined ${room.code}`);
      break;
    }
    case 'th':
      if (c.room && c.room.host !== c) send(c.room.host, { t: 'fromPeer', from: c.id, d: m.d });
      break;
    case 'bc':
      if (c.room && c.room.host === c) { const s = JSON.stringify({ t: 'fromHost', d: m.d }); for (const p of c.room.peers.values()) sendRaw(p, s); }
      break;
    case 'tp':
      if (c.room && c.room.host === c) { const p = c.room.peers.get(m.to); if (p) send(p, { t: 'fromHost', d: m.d }); }
      break;
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
  } else {
    room.peers.delete(c.id);
    send(room.host, { t: 'peerLeave', id: c.id });
  }
}
function drop(c) {
  if (!c.open) return;
  leave(c); c.open = false; clients.delete(c);
  try { c.socket.destroy(); } catch (_) {}
  log(`↔ player disconnected (${clients.size} online)`);
}
setInterval(() => { for (const c of clients) frame(c, 0x9, Buffer.alloc(0)); }, 20000);   // keep proxies from idling out

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
  console.log(`\n  ⭕ Ring Royale server v${VERSION} running on http://localhost:${PORT}`);
  console.log(`  Health check: /health   |   Fast test mode: /?fast\n`);
});
