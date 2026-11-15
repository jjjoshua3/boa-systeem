import { createClient } from "@supabase/supabase-js";
import { ipVan, noteerPoging } from "./ip.mjs";

const UUR = 60 * 60 * 1000;
const DRIE_DAGEN = 3 * 24 * UUR;
const PUBLIEK = "sb_publishable_x8nU8ype6b1KOL6K8lS2Iw_DDjz4Olr";
const PERMANENT = "Je account is permanent vergrendeld. Maak een ticket op servicedesk.boaportaal.nl. Support of beheer ontgrendelt het daarna in systeem.";

function koppen(request) {
  const bron = request.headers.get("origin") || "";
  const toegestaan = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(bron) ? bron : "https://boaportaal.nl";
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

function tijdelijk(tot) {
  const tekst = new Date(tot).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });
  return `Je account is vergrendeld tot ${tekst}. Drie foute wachtwoorden, zonder een goede ertussen. Na dit uur heb je nog één poging.`;
}

async function gebruikerOpMail(url, key, email) {
  const res = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return (json.users || []).find((user) => String(user.email || "").toLowerCase() === email) || null;
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: koppen(request) });
  if (request.method !== "POST") return antwoord(request, { fout: "POST" }, 405);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return antwoord(request, { fout: "De vergrendeling staat nog uit. Zet de Supabase-sleutel op de Netlify-site van systeem." }, 503);
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const wachtwoord = String(body.wachtwoord || "");
  if (!email.includes("@") || wachtwoord.length < 1 || wachtwoord.length > 200) {
    return antwoord(request, { fout: "Onjuist e-mailadres of wachtwoord." }, 401);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = await gebruikerOpMail(url, key, email);
  let rij = null;
  if (user?.id) {
    const { data, error } = await sb
      .from("boa_identiteit")
      .select("user_id, locked, mislukt, mislukt_sinds, slot_tot, slot_straf")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error && /column|schema/i.test(error.message)) {
      return antwoord(request, { fout: "Draai schema-0011.sql in Supabase. Daarna geldt de vergrendeling." }, 503);
    }
    rij = data;
  }
  if (rij?.locked) return antwoord(request, { fout: PERMANENT }, 423);
  if (rij?.slot_tot && new Date(rij.slot_tot).getTime() > Date.now()) {
    return antwoord(request, { fout: tijdelijk(rij.slot_tot) }, 423);
  }
  const publiek = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY || PUBLIEK, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await publiek.auth.signInWithPassword({ email, password: wachtwoord });
  if (error || !data.session) {
    const tekst = error?.message || "";
    if (/ban/i.test(tekst)) return antwoord(request, { fout: rij?.slot_tot ? tijdelijk(rij.slot_tot) : PERMANENT }, 423);
    if (!rij || !/invalid|credential/i.test(tekst)) {
      if (/invalid|credential/i.test(tekst)) await noteerPoging(ipVan(request), "portaal");
      return antwoord(request, { fout: "Onjuist e-mailadres of wachtwoord." }, 401);
    }
    const nu = Date.now();
    const tot = rij.slot_tot ? new Date(rij.slot_tot).getTime() : 0;
    if (rij.slot_straf && tot && tot <= nu) {
      await sb.from("boa_identiteit").update({ locked: true, mislukt: 0, mislukt_sinds: null, slot_tot: null, slot_straf: false }).eq("user_id", rij.user_id);
      await sb.auth.admin.updateUserById(rij.user_id, { ban_duration: "876000h" });
      await noteerPoging(ipVan(request), "portaal");
      return antwoord(request, { fout: PERMANENT }, 423);
    }
    let sinds = rij.mislukt_sinds ? new Date(rij.mislukt_sinds).getTime() : 0;
    let mislukt = Number(rij.mislukt) || 0;
    if (!sinds || nu - sinds > DRIE_DAGEN) {
      sinds = nu;
      mislukt = 1;
    } else {
      mislukt += 1;
    }
    if (mislukt >= 3) {
      const einde = new Date(nu + UUR).toISOString();
      await sb.from("boa_identiteit").update({
        mislukt: 0,
        mislukt_sinds: new Date(sinds).toISOString(),
        slot_tot: einde,
        slot_straf: true,
      }).eq("user_id", rij.user_id);
      await sb.auth.admin.updateUserById(rij.user_id, { ban_duration: "60m" });
      await noteerPoging(ipVan(request), "portaal");
      return antwoord(request, { fout: tijdelijk(einde) }, 423);
    }
    await sb.from("boa_identiteit").update({ mislukt, mislukt_sinds: new Date(sinds).toISOString() }).eq("user_id", rij.user_id);
    await noteerPoging(ipVan(request), "portaal");
    const rest = 3 - mislukt;
    return antwoord(request, { fout: `Onjuist e-mailadres of wachtwoord. Nog ${rest} ${rest === 1 ? "poging" : "pogingen"} binnen 3 dagen, daarna 60 minuten dicht.` }, 401);
  }
  if (rij && !rij.locked) {
    await sb.from("boa_identiteit").update({ mislukt: 0, mislukt_sinds: null, slot_tot: null, slot_straf: false }).eq("user_id", rij.user_id);
    await sb.auth.admin.updateUserById(rij.user_id, { ban_duration: "none" }).catch(() => null);
  }
  return antwoord(request, { sessie: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
};
