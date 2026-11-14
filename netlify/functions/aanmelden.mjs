import { createClient } from "@supabase/supabase-js";
import { admin, json } from "./lib.mjs";

const URL = "https://ofzyqwpztohflxdhqgbb.supabase.co";
const PUB = "sb_publishable_x8nU8ype6b1KOL6K8lS2Iw_DDjz4Olr";

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const body = await request.json().catch(() => ({}));
  const sleutel = String(body.sleutel || "").trim();
  const password = String(body.password || "");
  if (password.length < 8) return json({ fout: "Vul je Client-ID of zakelijk adres en je wachtwoord in." }, 400);
  let email = sleutel.toLowerCase();
  if (/^BP-\d{4}-[A-Z]{2}$/i.test(sleutel)) {
    const beheer = admin();
    if (!beheer) return json({ fout: "Voor een Client-ID mist de service-sleutel op de systeem-site. Log in met je zakelijke adres." }, 503);
    const { data: ident } = await beheer.from("boa_identiteit").select("user_id").eq("client_id", sleutel.toUpperCase()).maybeSingle();
    if (!ident?.user_id) return json({ fout: "Deze Client-ID en dit wachtwoord horen niet bij elkaar." }, 401);
    const user = await beheer.auth.admin.getUserById(ident.user_id);
    email = String(user.data?.user?.email || "").toLowerCase();
    if (!email) return json({ fout: "Deze Client-ID en dit wachtwoord horen niet bij elkaar." }, 401);
  } else if (!email.includes("@")) {
    return json({ fout: "Vul je Client-ID of je zakelijke adres in." }, 400);
  }
  const sb = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const inn = await sb.auth.signInWithPassword({ email, password });
  if (inn.error || !inn.data.session) return json({ fout: "Deze gegevens horen niet bij elkaar." }, 401);
  return json({
    access_token: inn.data.session.access_token,
    refresh_token: inn.data.session.refresh_token,
  });
};
