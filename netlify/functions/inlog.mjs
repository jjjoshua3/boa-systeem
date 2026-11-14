import { createClient } from "@supabase/supabase-js";

const HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function antwoord(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return antwoord({ fout: "POST" }, 405);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return antwoord({ fout: "De service-sleutel ontbreekt op de server." }, 503);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await request.json().catch(() => ({}));
  const bron = String(body.bron || "");
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  let userId = null;
  if (token.length > 20) {
    const { data } = await sb.auth.getUser(token);
    userId = data?.user?.id ?? null;
  }
  const ip =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const { error } = await sb.rpc("boa_inlog_vastleggen", {
    p_user: userId,
    p_email: userId ? "" : String(body.email || ""),
    p_bron: bron,
    p_resultaat: userId ? "geslaagd" : "mislukt",
    p_ip: ip,
  });
  if (error) return antwoord({ fout: "Niet vastgelegd." }, 500);
  return antwoord({ ok: true });
};
