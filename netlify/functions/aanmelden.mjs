import { createClient } from "@supabase/supabase-js";
import { admin } from "./lib.mjs";
import { ipVan, noteerPoging } from "./ip.mjs";

const URL = "https://ofzyqwpztohflxdhqgbb.supabase.co";
const PUB = "sb_publishable_x8nU8ype6b1KOL6K8lS2Iw_DDjz4Olr";

function antwoord(request, body, status = 200) {
  const origin = request.headers.get("origin") || "";
  const vrij = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(origin);
  const headers = { "content-type": "application/json" };
  if (vrij) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default async (request) => {
  if (request.method === "OPTIONS") return antwoord(request, {}, 204);
  if (request.method !== "POST") return antwoord(request, { fout: "POST" }, 405);
  const body = await request.json().catch(() => ({}));
  const sleutel = String(body.sleutel || "").trim();
  const password = String(body.password || "");
  const bron = body.bron === "servicedesk" ? "servicedesk" : "systeem";
  if (password.length < 8) return antwoord(request, { fout: "Vul je Client-ID of zakelijk adres en je wachtwoord in." }, 400);
  let email = sleutel.toLowerCase();
  if (/^BP-\d{4}-[A-Z]{2}$/i.test(sleutel)) {
    const beheer = admin();
    if (!beheer) return antwoord(request, { fout: "Voor een Client-ID mist de service-sleutel op de systeem-site. Log in met je zakelijke adres." }, 503);
    const { data: ident } = await beheer.from("boa_identiteit").select("user_id").eq("client_id", sleutel.toUpperCase()).maybeSingle();
    if (!ident?.user_id) {
      await noteerPoging(ipVan(request), bron, sleutel, false);
      return antwoord(request, { fout: "Deze Client-ID hoort niet bij een account." }, 401);
    }
    const user = await beheer.auth.admin.getUserById(ident.user_id);
    email = String(user.data?.user?.email || "").toLowerCase();
    if (!email) return antwoord(request, { fout: "Deze Client-ID hoort niet bij een account." }, 401);
  } else if (!email.includes("@")) {
    return antwoord(request, { fout: "Vul je Client-ID of je zakelijke adres in." }, 400);
  }
  const sb = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const inn = await sb.auth.signInWithPassword({ email, password });
  if (inn.error || !inn.data.session) {
    await noteerPoging(ipVan(request), bron, /^BP-\d{4}-[A-Z]{2}$/i.test(sleutel) ? sleutel : email, /^BP-\d{4}-[A-Z]{2}$/i.test(sleutel) ? true : null);
    const raw = String(inn.error?.message || "").toLowerCase();
    const fout = /confirm/.test(raw)
      ? "Bevestig eerst het adres via de mail. Daarna geldt hetzelfde wachtwoord."
      : /rate|too many/.test(raw)
        ? "Te veel pogingen. Wacht een minuut."
        : "Dit wachtwoord hoort niet bij dat account. Gebruik het wachtwoord van boaportaal.nl.";
    return antwoord(request, { fout }, 401);
  }
  return antwoord(request, {
    access_token: inn.data.session.access_token,
    refresh_token: inn.data.session.refresh_token,
  });
};
