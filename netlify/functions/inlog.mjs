import { createClient } from "@supabase/supabase-js";

const HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const BRONNEN = new Set(["portaal", "systeem", "servicedesk", "mail"]);

function antwoord(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function ipVan(request) {
  const lees = (naam) => request.headers.get(naam) || "";
  const ruw =
    lees("x-nf-client-connection-ip") ||
    lees("cf-connecting-ip") ||
    lees("x-real-ip") ||
    lees("x-forwarded-for").split(",")[0];
  return ruw.trim().replace(/[^0-9a-fA-F:.]/g, "").slice(0, 64);
}

async function gebruikerOpMail(url, key, email) {
  const res = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return (json.users || []).find((user) => String(user.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function wie(sb, url, key, userId, email) {
  let uid = userId || null;
  const invoer = String(email || "").trim();
  if (!uid && /^BP-\d{4}-[A-Z]{2}$/i.test(invoer)) {
    const { data } = await sb.from("boa_identiteit").select("user_id, client_id, pv_naam").eq("client_id", invoer.toUpperCase()).maybeSingle();
    if (data?.user_id) return { uid: data.user_id, client_id: data.client_id, pv_naam: data.pv_naam || "" };
  }
  if (!uid && invoer.includes("@")) {
    const user = await gebruikerOpMail(url, key, invoer);
    uid = user?.id || null;
  }
  if (!uid) return { uid: null, client_id: "", pv_naam: "" };
  const { data } = await sb.from("boa_identiteit").select("client_id, pv_naam").eq("user_id", uid).maybeSingle();
  return { uid, client_id: data?.client_id || "", pv_naam: data?.pv_naam || "" };
}

async function medewerker(sb, token) {
  if (!token || token.length < 20) return null;
  const { data } = await sb.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: med } = await sb.from("boa_medewerker").select("rol, actief, client_id").eq("user_id", uid).maybeSingle();
  if (!med?.actief || !["support", "beheerder"].includes(med.rol)) return null;
  return med;
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return antwoord({ fout: "POST" }, 405);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return antwoord({ fout: "De service-sleutel ontbreekt op de server." }, 503);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await request.json().catch(() => ({}));
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");

  if (body.actie === "lijst") {
    const med = await medewerker(sb, token);
    if (!med) return antwoord({ fout: "Geen toegang." }, 403);
    const dagen = Math.min(90, Math.max(1, Number(body.dagen) || 30));
    const sinds = new Date(Date.now() - dagen * 24 * 60 * 60 * 1000).toISOString();
    const bron = String(body.bron || "").trim().toLowerCase();
    const q = String(body.q || "").trim().toLowerCase();
    const doel = String(body.client_id || "").trim().toUpperCase();
    let userId = null;
    let local = "";
    if (doel) {
      const { data: ident } = await sb.from("boa_identiteit").select("user_id").eq("client_id", doel).maybeSingle();
      userId = ident?.user_id || null;
      if (userId) {
        const { data: user } = await sb.auth.admin.getUserById(userId);
        local = String(user?.user?.email || "").split("@")[0].toLowerCase();
      }
    }
    let query = sb.from("boa_inlog").select("moment, bron, resultaat, ip, client_id, pv_naam, user_id").gte("moment", sinds).order("moment", { ascending: false }).limit(400);
    if (bron && BRONNEN.has(bron)) query = query.eq("bron", bron);
    const { data, error } = await query;
    if (error) return antwoord({ fout: error.message }, 500);
    const magIp = med.rol === "beheerder";
    const rijen = (data || []).filter((rij) => {
      if (doel) {
        const zelf = rij.user_id && rij.user_id === userId;
        const code = String(rij.client_id || "").toUpperCase() === doel;
        const postbus = local && String(rij.client_id || "").toLowerCase() === local;
        if (!zelf && !code && !postbus) return false;
      }
      if (!q) return true;
      return `${rij.client_id} ${rij.pv_naam}`.toLowerCase().includes(q);
    }).map((rij) => ({
      moment: rij.moment,
      bron: rij.bron,
      resultaat: rij.resultaat,
      client_id: rij.client_id || "",
      pv_naam: rij.pv_naam || "",
      ip: magIp ? rij.ip || "" : "",
    }));
    return antwoord({ inlog: rijen, ip_zichtbaar: magIp });
  }

  const bron = String(body.bron || "").trim().toLowerCase();
  if (!BRONNEN.has(bron)) return antwoord({ fout: "Onbekende bron." }, 400);
  let userId = null;
  if (token.length > 20) {
    const { data } = await sb.auth.getUser(token);
    userId = data?.user?.id ?? null;
  }
  const persoon = await wie(sb, url, key, userId, body.email);
  const uitkomst = persoon.uid ? "geslaagd" : "mislukt";
  const { error } = await sb.from("boa_inlog").insert({
    user_id: persoon.uid,
    client_id: persoon.client_id,
    pv_naam: persoon.pv_naam,
    bron,
    resultaat: uitkomst,
    ip: ipVan(request),
  });
  if (error) return antwoord({ fout: error.message }, 500);
  return antwoord({ ok: true });
};
