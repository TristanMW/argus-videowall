// ─────────────────────────────────────────────────────────────────────────────
// Minimal mDNS responder (zero dependencies). Answers multicast DNS queries for
// a single hostname (default "argus.local") with this machine's LAN IPv4, so
// devices can reach the box at http://argus.local:8080 without knowing its IP.
//
// Entirely local: multicast to 224.0.0.251 on the LAN, nothing leaves the
// network. Best-effort — if it can't join multicast (e.g. Docker bridge without
// host networking) it logs and the rest of Argus keeps working.
// ─────────────────────────────────────────────────────────────────────────────
const dgram = require("dgram");
const os = require("os");

const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;

function localIPv4() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

function encodeName(name) {
  const bufs = [];
  for (const label of name.split(".").filter(Boolean)) {
    const b = Buffer.from(label, "utf8");
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function buildAnswer(name, ip) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // flags: response + authoritative
  header.writeUInt16BE(1, 6); // ANCOUNT = 1
  const rr = Buffer.alloc(10 + 4);
  let o = 0;
  rr.writeUInt16BE(1, o); o += 2; // TYPE A
  rr.writeUInt16BE(0x8001, o); o += 2; // CLASS IN + cache-flush bit
  rr.writeUInt32BE(120, o); o += 4; // TTL
  rr.writeUInt16BE(4, o); o += 2; // RDLENGTH
  ip.split(".").forEach((oct, i) => (rr[o + i] = Number(oct) & 0xff));
  return Buffer.concat([header, encodeName(name), rr]);
}

function parseQuestions(msg) {
  try {
    const qd = msg.readUInt16BE(4);
    let off = 12;
    const out = [];
    for (let q = 0; q < qd; q++) {
      const labels = [];
      while (off < msg.length) {
        const len = msg[off++];
        if (len === 0) break;
        if ((len & 0xc0) === 0xc0) { off++; break; } // compression pointer
        labels.push(msg.toString("utf8", off, off + len));
        off += len;
      }
      const type = msg.readUInt16BE(off); off += 2;
      off += 2; // class
      out.push({ name: labels.join(".").toLowerCase(), type });
    }
    return out;
  } catch {
    return [];
  }
}

function startMdns(name = "argus.local") {
  const target = name.toLowerCase();
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

  sock.on("error", (e) => {
    console.warn("[argus] mDNS disabled:", e.message);
    try { sock.close(); } catch {}
  });

  sock.on("message", (msg) => {
    const qs = parseQuestions(msg);
    if (!qs.some((q) => q.name === target && (q.type === 1 || q.type === 255))) return;
    const ip = localIPv4();
    if (!ip) return;
    const ans = buildAnswer(name, ip);
    sock.send(ans, 0, ans.length, MDNS_PORT, MDNS_ADDR);
  });

  sock.bind(MDNS_PORT, () => {
    try {
      sock.addMembership(MDNS_ADDR);
      sock.setMulticastTTL(255);
      const ip = localIPv4();
      console.log(`[argus] mDNS advertising ${name}` + (ip ? ` -> ${ip}:8080` : ""));
      if (ip) {
        const a = buildAnswer(name, ip); // unsolicited announcement
        sock.send(a, 0, a.length, MDNS_PORT, MDNS_ADDR);
      }
    } catch (e) {
      console.warn("[argus] mDNS membership failed:", e.message);
    }
  });

  return sock;
}

module.exports = { startMdns };
