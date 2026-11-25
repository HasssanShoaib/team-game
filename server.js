// =============================================================================
// Ring Royale — zero-dependency relay server (HTTP + WebSocket)
// Run:  node server.js        (Node 18+)   ->  http://localhost:3000
// Serves index.html and relays room messages. The room HOST runs the game
// simulation (host-authoritative); this server only routes messages.
// =============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_PEERS = 11;                 // + host = 12 fighters max (bots count too, host enforces)
const rooms = new Map();              // code -> { code, host, peers: Map }
const clients = new Set();
let seq = 1;

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, ringRoyale: true, rooms: rooms.size, clients: clients.size }));
  }
  res.writeHead(404); res.end('Not found');
});

// ---------- Minimal RFC 6455 WebSocket ----------
server.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { id: 'p' + (seq++).toString(36) + crypto.randomBytes(2).toString('hex'), socket, buf: Buffer.alloc(0), room: null, open: true };
  clients.add(c);
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
    const op = c.buf[0] & 0x0f, masked = c.buf[1] & 0x80;
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
    if (op !== 0x1) continue;
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
    case 'create': {
      leave(c);
      const room = { code: genCode(), host: c, peers: new Map() };
      rooms.set(room.code, room); c.room = room;
      send(c, { t: 'created', code: room.code, id: c.id });
      console.log(`  ✔ Room ${room.code} created`);
      break;
    }
    case 'join': {
      leave(c);
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(c, { t: 'err', msg: 'Room not found. Check the code.' });
      if (room.peers.size >= MAX_PEERS) return send(c, { t: 'err', msg: 'That room is full.' });
      room.peers.set(c.id, c); c.room = room;
      send(c, { t: 'joined', code: room.code, id: c.id });
      send(room.host, { t: 'peerJoin', id: c.id, name: String(m.name || 'Pilot').slice(0, 16), color: String(m.color || '#22d3ee').slice(0, 9) });
      console.log(`  ✔ ${m.name} joined ${room.code}`);
      break;
    }
    case 'th':  // peer -> host
      if (c.room && c.room.host !== c) send(c.room.host, { t: 'fromPeer', from: c.id, d: m.d });
      break;
    case 'bc':  // host -> all peers
      if (c.room && c.room.host === c) { const s = JSON.stringify({ t: 'fromHost', d: m.d }); for (const p of c.room.peers.values()) sendRaw(p, s); }
      break;
    case 'tp':  // host -> one peer
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
    console.log(`  ✖ Room ${room.code} closed`);
  } else {
    room.peers.delete(c.id);
    send(room.host, { t: 'peerLeave', id: c.id });
  }
}
function drop(c) {
  if (!c.open) return;
  leave(c); c.open = false; clients.delete(c);
  try { c.socket.destroy(); } catch (_) {}
}
// Keep proxies (e.g. Codespaces port forwarding) from idling out connections
setInterval(() => { for (const c of clients) frame(c, 0x9, Buffer.alloc(0)); }, 25000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⭕ Ring Royale server running on http://localhost:${PORT}`);
  console.log(`  Health check: /health   |   Fast test mode: /?fast\n`);
});
