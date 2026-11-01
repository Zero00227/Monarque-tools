// api/probe.js — vérifie l'existence d'un compte sans API officielle
const mem = new Map();
const TTL = 6 * 60 * 60 * 1000;

function normalize(raw) {
  if (typeof raw !== "string") return "";
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length < 6 || d.length > 20) return "";
  return d;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=3600");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET uniquement." });

  const numero = normalize(req.query.numero);
  if (!numero) return res.status(400).json({ error: "Numéro invalide." });

  const hit = mem.get(numero);
  if (hit && Date.now() - hit.at < TTL) return res.status(200).json(hit.data);

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);

  try {
    const r = await fetch(
      `https://api.whatsapp.com/send?phone=${numero}&text=&lang=fr`,
      {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
        }
      }
    );

    const html = await r.text();

    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const invite =
      /invite|invitation|not registered|n'est pas sur whatsapp|pas sur whatsapp|invalid|invalide/i.test(html);

    let registered = null;
    if (invite) registered = false;
    else if (title && !/^whatsapp$/i.test(title) && !/^\+\d+$/.test(title)) registered = true;
    else if (title) registered = null;

    const name = registered && title && !/^\+\d+$/.test(title) ? title.slice(0, 60) : "";

    const data = { numero: "+" + numero, registered, name, at: Date.now() };
    if (mem.size > 3000) mem.clear();
    mem.set(numero, { at: Date.now(), data });

    return res.status(200).json(data);
  } catch {
    return res.status(200).json({ numero: "+" + numero, registered: null, name: "", at: Date.now() });
  } finally {
    clearTimeout(to);
  }
    }
