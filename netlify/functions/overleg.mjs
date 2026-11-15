import { beheerder } from "./lib.mjs";

function koppen(request) {
  const bron = request.headers.get("origin") || "";
  const toegestaan = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(bron) ? bron : "https://overleg.boaportaal.nl";
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
  const { data: recht } = await poort.sb.from("boa_medewerker").select("rol, client_id, pv_naam, actief").eq("user_id", poort.user.id).maybeSingle();
  if (!recht?.actief) return antwoord(request, { fout: "Alleen voor medewerkers." }, 403);

  if (body.actie === "ticket") {
    const nummer = String(body.nummer || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
    if (nummer.length < 4) return antwoord(request, { fout: "Vul een ticketnummer in, bijvoorbeeld M2611-0412." }, 400);
    const { data, error } = await poort.sb.from("boa_ticket").select("nummer, client_id, pv_naam, status").ilike("nummer", `%${nummer}%`).limit(6);
    if (error) return antwoord(request, { fout: "Het ticket is niet gevonden." }, 500);
    return antwoord(request, { tickets: data || [] });
  }

  if (body.actie === "taken") {
    const { data, error } = await poort.sb.from("boa_voorstel").select("id, soort, sleutel, titel, status, indiener, gemaakt").eq("status", "wacht").order("gemaakt", { ascending: false }).limit(40);
    if (error) return antwoord(request, { fout: "De wachtrij is niet geladen." }, 500);
    return antwoord(request, { taken: data || [] });
  }

  if (body.actie === "voorstel") {
    const soort = body.soort === "boom" ? "boom" : "feit";
    const sleutel = String(body.sleutel || "").trim().slice(0, 120);
    const titel = String(body.titel || "").trim().slice(0, 180);
    const tekst = String(body.tekst || "").trim().slice(0, 4000);
    if (!sleutel || !titel || !tekst) return antwoord(request, { fout: "Vul een code of id, een titel en de tekst in." }, 400);
    const payload = soort === "feit"
      ? { id: sleutel, code: sleutel, titel, artikel: String(body.artikel || "").slice(0, 240), domeinen: ["algemeen"], afdoening: "om", afdoeningLabel: "", kwalificatie: tekst, leeftijd: "", bijzonder: "", tarief: "", pv: "", trefwoorden: "" }
      : { id: sleutel, titel, domeinen: ["algemeen"], inleiding: tekst, start: "start", nodes: [{ id: "start", soort: "vraag", titel, tekst, keuzes: [] }] };
    const { data, error } = await poort.sb.from("boa_voorstel").insert({ soort, sleutel, titel, payload, indiener: recht.client_id }).select("id, soort, sleutel, titel, status").single();
    if (error) return antwoord(request, { fout: "Het voorstel is niet opgeslagen. Draai schema-0014.sql." }, 500);
    await poort.sb.from("boa_audit").insert({
      beheerder_id: recht.client_id,
      beheerder_naam: recht.pv_naam,
      doel_client_id: "",
      doel_pv_naam: titel,
      ticketnummer: sleutel,
      reden: `Voorstel uit het overleg voor ${soort === "feit" ? "een feitcode" : "een beslisboom"}: ${titel}. Sleutel ${sleutel}. Staat nog niet op de site.`,
      soort: "REDACTIE_VOORSTEL",
      niveau: "INFO",
      bron: soort === "feit" ? "feitcode" : "beslisboom",
    });
    return antwoord(request, { voorstel: data });
  }

  if (body.actie === "keur") {
    if (recht.rol !== "beheerder") return antwoord(request, { fout: "Alleen de hoofdbeheerder zet dit op de site." }, 403);
    const id = String(body.id || "");
    const { data: rij, error } = await poort.sb.from("boa_voorstel").select("id, soort, sleutel, titel, payload, status, indiener").eq("id", id).maybeSingle();
    if (error || !rij || rij.status !== "wacht") return antwoord(request, { fout: "Dit voorstel ligt niet meer ter beoordeling." }, 404);
    const opslag = await poort.sb.from("boa_inhoud").upsert({ soort: rij.soort, sleutel: rij.sleutel, payload: rij.payload, sinds: new Date().toISOString(), door: recht.client_id });
    if (opslag.error) return antwoord(request, { fout: "Publiceren is niet gelukt." }, 500);
    await poort.sb.from("boa_voorstel").update({ status: "goed", beoordeeld_door: recht.client_id, beoordeeld_op: new Date().toISOString() }).eq("id", id);
    await poort.sb.from("boa_audit").insert({
      beheerder_id: recht.client_id,
      beheerder_naam: recht.pv_naam,
      doel_client_id: "",
      doel_pv_naam: rij.titel,
      ticketnummer: rij.sleutel,
      reden: `Goedgekeurd vanuit het overleg en op boaportaal.nl gezet: ${rij.titel}. Sleutel ${rij.sleutel}. Voorgelegd door ${rij.indiener}.`,
      soort: "REDACTIE_GOED",
      niveau: "HIGH",
      bron: rij.soort === "feit" ? "feitcode" : "beslisboom",
    });
    return antwoord(request, { ok: true });
  }

  return antwoord(request, { fout: "Onbekende actie." }, 400);
}
