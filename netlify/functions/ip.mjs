import { beheerder } from "./lib.mjs";

const DREMPEL = 5;
const VENSTER = 60 * 60 * 1000;

function koppen(request) {
  const bron = request.headers.get("origin") || "";
  const toegestaan = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(bron) ? bron : "https://ip.boaportaal.nl";
  return {
    "content-type": "application/json",
    "access-control-allow-origin": toegestaan,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}

function antwoord(request, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: koppen(request) });
}

export function ipVan(request) {
  const direct = request.headers.get("x-nf-client-connection-ip") || "";
  if (direct.trim()) return direct.trim().slice(0, 64);
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);
}

function schoonIp(waarde) {
  const ip = String(waarde || "").trim().slice(0, 64);
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return "";
  return ip;
}

function referentie() {
  const tekens = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let uit = "SOC-";
  for (const byte of bytes) uit += tekens[byte % tekens.length];
  return uit;
}

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function db() {
  const env = adminClient();
  if (!env) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function naarBuiten(rij, ip) {
  if (!rij?.actief) return { blok: false, ip };
  return { blok: true, ip: rij.ip || ip, referentie: rij.referentie, sinds: rij.gemaakt };
}

async function bestaand(sb, ip) {
  const { data, error } = await sb.from("boa_ip_blok").select("ip, referentie, reden, bron, pogingen, actief, gemaakt, door, opgeheven, opgeheven_door").eq("ip", ip).eq("actief", true).order("gemaakt", { ascending: false }).limit(1).maybeSingle();
  if (error) return { fout: error.message };
  return { rij: data };
}

export async function noteerPoging(ip, bron) {
  const schoon = schoonIp(ip);
  if (!schoon) return { blok: false, ip: "" };
  const sb = await db();
  if (!sb) return { blok: false, ip: schoon };
  const nu = await bestaand(sb, schoon);
  if (nu.fout) return { blok: false, ip: schoon };
  if (nu.rij) return naarBuiten(nu.rij, schoon);
  const insert = await sb.from("boa_ip_poging").insert({ ip: schoon, bron: String(bron || "onbekend").slice(0, 40) });
  if (insert.error) return { blok: false, ip: schoon };
  const sinds = new Date(Date.now() - VENSTER).toISOString();
  const { data: pogingen } = await sb.from("boa_ip_poging").select("bron").eq("ip", schoon).gte("moment", sinds);
  const lijst = pogingen || [];
  if (lijst.length < DREMPEL) return { blok: false, ip: schoon, open: DREMPEL - lijst.length };
  const bronnen = [...new Set(lijst.map((regel) => regel.bron).filter(Boolean))].join(", ") || bron;
  const reden = `${lijst.length} mislukte aanmeldpogingen binnen een uur. Gezien op: ${bronnen}.`;
  const { data } = await sb.from("boa_ip_blok").insert({
    ip: schoon,
    referentie: referentie(),
    reden,
    bron: bronnen,
    pogingen: lijst.length,
    door: "SOC",
  }).select("ip, referentie, gemaakt, actief").single();
  return naarBuiten(data, schoon);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: koppen(request) });
  if (request.method !== "POST") return antwoord(request, { fout: "POST" }, 405);
  const body = await request.json().catch(() => ({}));
  const actie = String(body.actie || "kijk");
  const gezien = ipVan(request);

  if (actie === "kijk") {
    const sb = await db();
    if (!sb || !gezien) return antwoord(request, { blok: false, ip: gezien });
    const nu = await bestaand(sb, gezien);
    if (nu.fout || !nu.rij) return antwoord(request, { blok: false, ip: gezien });
    return antwoord(request, naarBuiten(nu.rij, gezien));
  }

  if (actie === "poging") {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const ip = token && token === key ? schoonIp(body.ip) || gezien : gezien;
    const uit = await noteerPoging(ip, body.bron || "onbekend");
    return antwoord(request, uit);
  }

  const poort = await beheerder(request, ["beheerder"]);
  if (poort.fout) return antwoord(request, { fout: poort.fout }, poort.status);
  const sb = poort.sb;

  if (actie === "lijst" || actie === "zoek") {
    const kolommen = "ip, referentie, reden, bron, pogingen, actief, gemaakt, door, opgeheven, opgeheven_door";
    const q = String(body.q || "").trim().slice(0, 80);
    if (!q) {
      const { data, error } = await sb.from("boa_ip_blok").select(kolommen).order("gemaakt", { ascending: false }).limit(40);
      if (error) return antwoord(request, { fout: "Draai schema-0012.sql in Supabase." }, 500);
      return antwoord(request, { blokken: data || [] });
    }
    const ref = q.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const ip = schoonIp(q);
    const [opRef, opIp] = await Promise.all([
      ref ? sb.from("boa_ip_blok").select(kolommen).ilike("referentie", `%${ref}%`).limit(20) : Promise.resolve({ data: [] }),
      ip ? sb.from("boa_ip_blok").select(kolommen).eq("ip", ip).limit(20) : Promise.resolve({ data: [] }),
    ]);
    if (opRef.error || opIp.error) return antwoord(request, { fout: "Draai schema-0012.sql in Supabase." }, 500);
    const gezien = new Set();
    const blokken = [...(opRef.data || []), ...(opIp.data || [])].filter((rij) => {
      if (gezien.has(rij.referentie)) return false;
      gezien.add(rij.referentie);
      return true;
    });
    return antwoord(request, { blokken });
  }

  if (actie === "blokkeer") {
    const ip = schoonIp(body.ip);
    const reden = String(body.reden || "").trim().slice(0, 400);
    if (!ip) return antwoord(request, { fout: "Vul een geldig IP-adres in." }, 400);
    if (reden.length < 12) return antwoord(request, { fout: "De reden moet minstens 12 tekens zijn." }, 400);
    const nu = await bestaand(sb, ip);
    if (nu.rij) return antwoord(request, { fout: `Dit adres is al geblokkeerd onder ${nu.rij.referentie}.` }, 409);
    const { data, error } = await sb.from("boa_ip_blok").insert({
      ip,
      referentie: referentie(),
      reden,
      bron: "handmatig",
      pogingen: 0,
      door: poort.med.client_id,
    }).select("ip, referentie, reden, bron, pogingen, actief, gemaakt, door").single();
    if (error) return antwoord(request, { fout: "Draai schema-0012.sql in Supabase." }, 500);
    return antwoord(request, { blok: data });
  }

  if (actie === "vrij") {
    const ref = String(body.referentie || "").trim().toUpperCase();
    if (!/^SOC-[A-Z0-9]{6}$/.test(ref)) return antwoord(request, { fout: "Onbekende referentie." }, 400);
    const { data, error } = await sb.from("boa_ip_blok").update({
      actief: false,
      opgeheven: new Date().toISOString(),
      opgeheven_door: poort.med.client_id,
    }).eq("referentie", ref).eq("actief", true).select("referentie, ip").maybeSingle();
    if (error || !data) return antwoord(request, { fout: "Die blokkade staat niet meer open." }, 404);
    return antwoord(request, { ok: true, blok: data });
  }

  return antwoord(request, { fout: "Onbekende actie." }, 400);
}
