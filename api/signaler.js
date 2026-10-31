// api/signaler.js — Node runtime, ESM
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const USE_KV = Boolean(KV_URL && KV_TOKEN);

// Repli mémoire (instance unique, éphémère) si aucune base n'est configurée
const mem = new Map();
const MAX_MEM = 5000;
const memRate = new Map();

const LIMIT = 30;               // requêtes
const WINDOW = 60;              // par fenêtre de 60 s
const TTL = 60 * 60 * 24 * 180; // 180 jours de rétention

/* ---------- client Redis REST ---------- */
async function kv(...cmd) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error("KV " + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

/* ---------- helpers ---------- */
function normalize(raw) {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 6 || digits.length > 20) return "";
  return "+" + digits;
}

function clientIp(req) {
  const f = req.headers["x-forwarded-for"];
  return (f ? String(f).split(",")[0] : req.socket?.remoteAddress || "anon").trim();
}

async function incr(key) {
  if (USE_KV) return Number(await kv("INCR", key));
  const n = (mem.get(key) || 0) + 1;
  if (mem.size >= MAX_MEM) mem.delete(mem.keys().next().value);
  mem.set(key, n);
  return n;
}

async function read(key) {
  if (USE_KV) return Number((await kv("GET", key)) || 0);
  return mem.get(key) || 0;
}

async function expire(key, s) {
  if (USE_KV) await kv("EXPIRE", key, s);
}

async function rateLimited(ip) {
  const key = "rl:" + ip;
  try {
    if (USE_KV) {
      const n = Number(await kv("INCR", key));
      if (n === 1) await kv("EXPIRE", key, WINDOW);
      return n > LIMIT;
    }
    const now = Date.now();
    const e = memRate.get(ip);
    if (!e || now > e.reset) {
      memRate.set(ip, { n: 1, reset: now + WINDOW * 1000 });
      return false;
    }
    e.n += 1;
    return e.n > LIMIT;
  } catch {
    return false;
  }
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (await rateLimited(clientIp(req))) {
    return res.status(429).json({ error: "Trop de requêtes, réessaie dans une minute." });
  }

  /* --- lecture du total --- */
  if (req.method === "GET") {
    const numero = normalize(req.query.numero || req.query.n);
    if (!numero) return res.status(400).json({ error: "Numéro invalide ou manquant." });
    try {
      const total = await read("sig:" + numero);
      return res.status(200).json({ numero, total, source: USE_KV ? "kv" : "memory" });
    } catch {
      return res.status(200).json({ numero, total: 0, source: "memory" });
    }
  }

  /* --- enregistrement --- */
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const numero = normalize(body?.numero);
    if (!numero) return res.status(400).json({ error: "Numéro invalide ou manquant." });

    const motif = String(body?.motif || "inconnu").slice(0, 40).replace(/[^\w:-]/g, "");
    const key = "sig:" + numero;

    try {
      const total = await incr(key);
      await expire(key, TTL);
      if (motif) {
        if (USE_KV) await kv("HINCRBY", "motifs:" + numero, motif, 1);
        else mem.set("motif:" + numero + ":" + motif, (mem.get("motif:" + numero + ":" + motif) || 0) + 1);
      }
      return res.status(200).json({ success: true, numero, total, source: USE_KV ? "kv" : "memory" });
    } catch (e) {
      return res.status(200).json({ success: false, numero, total: 0, source: "memory" });
    }
  }

  return res.status(405).json({ error: "Méthode non autorisée." });
}
