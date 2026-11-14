import { createClient } from "@supabase/supabase-js";

export function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function beheerder(request, rollen) {
  const sb = admin();
  if (!sb) return { fout: "De service-sleutel ontbreekt op de server.", status: 503 };
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token.length < 20) return { fout: "Niet aangemeld.", status: 401 };
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return { fout: "Sessie ongeldig.", status: 401 };
  const { data: med } = await sb.from("boa_medewerker").select("rol, client_id, actief").eq("user_id", data.user.id).maybeSingle();
  if (!med?.actief || !rollen.includes(med.rol)) return { fout: "Geen recht voor deze handeling.", status: 403 };
  return { sb, user: data.user, med };
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
