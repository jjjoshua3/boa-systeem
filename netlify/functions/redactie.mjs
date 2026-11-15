import { beheerder } from "./lib.mjs";

const SOORTEN = new Set(["feit", "boom", "jargon", "vraag", "beginsel", "casus"]);

function koppen(request) {
  const bron = request.headers.get("origin") || "";
  const toegestaan = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(bron) ? bron : "https://feitcode.boaportaal.nl";
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

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: koppen(request) });
  if (request.method !== "POST") return antwoord(request, { fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder", "support"]);
  if (poort.fout) return antwoord(request, { fout: poort.fout }, poort.status);
  const body = await request.json().catch(() => ({}));
  const { data: recht, error: rechtFout } = await poort.sb
    .from("boa_medewerker")
    .select("mag_feit, mag_boom, mag_jargon, mag_trainer, rol, client_id, pv_naam")
    .eq("user_id", poort.user.id)
    .maybeSingle();
  if (rechtFout) return antwoord(request, { fout: "Draai schema-0014.sql in Supabase." }, 500);
  const beheer = recht?.rol === "beheerder";
  const mag = {
    feit: beheer || Boolean(recht?.mag_feit),
    boom: beheer || Boolean(recht?.mag_boom),
    jargon: beheer || Boolean(recht?.mag_jargon),
    trainer: beheer || Boolean(recht?.mag_trainer),
  };
  const actie = String(body.actie || "ik");
  if (actie === "ik") {
    return antwoord(request, { client_id: recht.client_id, pv_naam: recht.pv_naam, rol: recht.rol, mag, keuren: beheer });
  }
  if (actie === "lijst") {
    const soort = String(body.soort || "");
    const soorten = soort === "trainer" ? ["vraag", "beginsel", "casus"] : [soort];
    if (!soorten.every((item) => SOORTEN.has(item))) return antwoord(request, { fout: "Onbekend onderdeel." }, 400);
    if (!soorten.some((item) => magVan(mag, item))) return antwoord(request, { fout: "Geen redactierecht voor dit onderdeel." }, 403);
    const { data, error } = await poort.sb.from("boa_voorstel").select("id, soort, sleutel, titel, payload, basis, status, indiener, gemaakt, notitie").in("soort", soorten).order("gemaakt", { ascending: false }).limit(40);
    if (error) return antwoord(request, { fout: "Draai schema-0014.sql in Supabase." }, 500);
    const zichtbaar = beheer ? data : (data || []).filter((rij) => rij.status === "wacht" && rij.indiener === recht.client_id);
    return antwoord(request, { voorstellen: zichtbaar || [] });
  }
  if (actie === "voorstel") {
    const soort = String(body.soort || "");
    if (!SOORTEN.has(soort) || !magVan(mag, soort)) return antwoord(request, { fout: "Geen redactierecht voor dit onderdeel." }, 403);
    const sleutel = String(body.sleutel || "").trim().slice(0, 120);
    const titel = String(body.titel || "").trim().slice(0, 180);
    const payload = body.payload;
    if (!sleutel || !payload || typeof payload !== "object" || Array.isArray(payload)) return antwoord(request, { fout: "Het voorstel is niet volledig." }, 400);
    if (JSON.stringify(payload).length > 100000) return antwoord(request, { fout: "Dit voorstel is te lang." }, 400);
    const { error } = await poort.sb.from("boa_voorstel").insert({
      soort,
      sleutel,
      titel: titel || sleutel,
      payload,
      basis: body.basis && typeof body.basis === "object" ? body.basis : null,
      indiener: recht.client_id,
    });
    if (error) return antwoord(request, { fout: "Draai schema-0014.sql in Supabase." }, 500);
    return antwoord(request, { ok: true });
  }
  if (actie === "keur") {
    if (!beheer) return antwoord(request, { fout: "Alleen de hoofdbeheerder keurt goed." }, 403);
    const id = String(body.id || "");
    const besluit = body.besluit === "goed" ? "goed" : body.besluit === "af" ? "af" : "";
    if (!besluit) return antwoord(request, { fout: "Kies goedkeuren of afwijzen." }, 400);
    const { data: rij, error } = await poort.sb.from("boa_voorstel").select("id, soort, sleutel, payload, status").eq("id", id).maybeSingle();
    if (error || !rij || rij.status !== "wacht") return antwoord(request, { fout: "Dit voorstel ligt niet meer ter beoordeling." }, 404);
    if (besluit === "goed") {
      const opslag = await poort.sb.from("boa_inhoud").upsert({
        soort: rij.soort,
        sleutel: rij.sleutel,
        payload: rij.payload,
        sinds: new Date().toISOString(),
        door: recht.client_id,
      });
      if (opslag.error) return antwoord(request, { fout: "Draai schema-0014.sql in Supabase." }, 500);
    }
    await poort.sb.from("boa_voorstel").update({
      status: besluit,
      beoordeeld_door: recht.client_id,
      beoordeeld_op: new Date().toISOString(),
      notitie: String(body.notitie || "").slice(0, 400),
    }).eq("id", id);
    return antwoord(request, { ok: true });
  }
  return antwoord(request, { fout: "Onbekende actie." }, 400);
}

function magVan(mag, soort) {
  if (soort === "vraag" || soort === "beginsel" || soort === "casus") return mag.trainer;
  return Boolean(mag[soort]);
}
