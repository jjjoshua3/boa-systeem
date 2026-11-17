import { beheerder, json, maakPostbus, nieuwPostbusWachtwoord, verwijderPostbus, verstuurUitnodiging, verstuurPostbusWachtwoord, verstuurRedactie, zetPostbusWachtwoord } from "./lib.mjs";

function naarPv(raw) {
  const t = String(raw || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const mooi = (woord) => {
    const s = String(woord || "").replace(/\./g, "");
    return s ? s.slice(0, 1).toUpperCase() + s.slice(1).toLowerCase() : "";
  };
  const initialen = (tekst) => String(tekst || "").split(/\s+/).filter(Boolean).map((woord) => woord.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase()).filter(Boolean);
  if (t.includes(",")) {
    const [links, rechts] = t.split(",", 2);
    const linksT = links.trim();
    const rechtsT = String(rechts || "").trim();
    const delen = rechtsT.split(/\s+/).filter(Boolean);
    const alleen = delen.length > 0 && delen.every((woord) => /^[A-Za-z]\.?$/.test(woord));
    if (!/[A-Za-z]/.test(rechtsT)) return mooi(linksT);
    if (alleen) {
      const inits = delen.map((woord) => woord.replace(/\./g, "").slice(0, 1).toUpperCase());
      if (linksT === linksT.toUpperCase()) return `${inits[0]}., ${initialen(linksT).join(" ")}.`;
      return `${mooi(linksT)}, ${inits.join(" ")}.`;
    }
    const letters = initialen(linksT);
    return letters.length ? `${mooi(rechtsT)}, ${letters.join(" ")}.` : mooi(rechtsT);
  }
  const parts = t.split(/\s+/).filter(Boolean);
  const rest = initialen(parts.slice(1).join(" "));
  return rest.length ? `${mooi(parts[0])}, ${rest.join(" ")}.` : mooi(parts[0]);
}

function mailStuk(waarde) {
  return String(waarde || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function mailLocalVan(voornaam, achternaam) {
  const voor = mailStuk(voornaam);
  const achter = mailStuk(achternaam);
  if (voor.length < 2 || achter.length < 2) return "";
  return `${voor}.${achter}`.slice(0, 64);
}

function isClientPostbus(local) {
  return /^bp-\d{4}-[a-z]{2}$/.test(String(local || ""));
}

function clientId() {
  const n = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  const a = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const b = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `BP-${n}-${a}${b}`;
}

async function zoekEmail(sb, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((user) => String(user.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function zorgIdentiteit(sb, user, pv) {
  const { data: bestaand } = await sb.from("boa_identiteit").select("client_id, pv_naam").eq("user_id", user.id).maybeSingle();
  if (bestaand?.client_id) {
    const beter = pv && pv.length >= 3 ? pv : "";
    if (beter && (bestaand.pv_naam === "ONBEKEND, ." || !bestaand.pv_naam)) {
      await sb.from("boa_identiteit").update({ pv_naam: beter }).eq("user_id", user.id);
      await sb.from("boa_medewerker").update({ pv_naam: beter }).eq("user_id", user.id);
      return { client_id: bestaand.client_id, pv_naam: beter };
    }
    return bestaand;
  }
  const naam = pv && pv.length >= 3 ? pv : naarPv(user.user_metadata?.naam || user.email?.split("@")[0] || "ONBEKEND");
  let cid = clientId();
  for (let i = 0; i < 5; i += 1) {
    const { error } = await sb.from("boa_identiteit").insert({ user_id: user.id, client_id: cid, pv_naam: naam });
    if (!error) return { client_id: cid, pv_naam: naam };
    cid = clientId();
  }
  return null;
}

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const body = await request.json();
  if (body.actie === "lijst") {
    const q = String(body.q || "").trim().toLowerCase();
    const { data, error } = await poort.sb.from("boa_medewerker").select("user_id, client_id, pv_naam, rol, actief, whatsapp, mag_feit, mag_boom, mag_jargon, mag_trainer").order("pv_naam");
    const bron = error
      ? await poort.sb.from("boa_medewerker").select("user_id, client_id, pv_naam, rol, actief").order("pv_naam")
      : { data, error: null };
    if (bron.error) return json({ fout: "De medewerkers zijn niet geladen." }, 500);
    const rijen = [];
    for (const rij of bron.data || []) {
      const ident = await poort.sb.from("boa_identiteit").select("mfa_uren").eq("user_id", rij.user_id).maybeSingle();
      const user = await poort.sb.auth.admin.getUserById(rij.user_id);
      let postbus = String(user.data?.user?.user_metadata?.mail_local || "");
      if (rij.client_id === "BP-0164-RW" && postbus.toLowerCase() !== "jurensly.nurse") {
        const meta = user.data?.user?.user_metadata || {};
        await poort.sb.auth.admin.updateUserById(rij.user_id, {
          user_metadata: { ...meta, mail_local: "jurensly.nurse", voornaam: "Jurensly", achternaam: "Nurse", client_id: "BP-0164-RW" },
        });
        await poort.sb.from("boa_mail_adres").upsert({
          local: "jurensly.nurse",
          voornaam: "Jurensly",
          achternaam: "Nurse",
          zoek_naam: true,
          bijgewerkt: new Date().toISOString(),
        });
        postbus = "jurensly.nurse";
      }
      const kaart = {
        client_id: rij.client_id,
        pv_naam: rij.pv_naam,
        rol: rij.rol,
        actief: rij.actief,
        whatsapp: Boolean(rij.whatsapp),
        feit: Boolean(rij.mag_feit),
        boom: Boolean(rij.mag_boom),
        jargon: Boolean(rij.mag_jargon),
        trainer: Boolean(rij.mag_trainer),
        mfa_uren: Number(ident.data?.mfa_uren) || 8,
        postbus,
      };
      const tekst = `${kaart.client_id} ${kaart.pv_naam} ${kaart.rol} ${postbus}`.toLowerCase();
      if (!q || tekst.includes(q)) rijen.push(kaart);
    }
    return json({ medewerkers: rijen });
  }
  if (body.actie === "profiel") {
    const cid = String(body.client_id || "").trim().toUpperCase();
    const reden = String(body.reden || "").trim();
    const pv = String(body.pv_naam || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const postbus = mailLocalVan(body.voornaam, body.achternaam);
    if (!/^BP-\d{4}-[A-Z]{2}$/.test(cid)) return json({ fout: "Geen geldige Client-ID." }, 400);
    if (reden.length < 12) return json({ fout: "De reden is te kort." }, 400);
    if (String(body.voornaam || "").trim() && !postbus) return json({ fout: "Voornaam en achternaam zijn allebei nodig. Het mailadres wordt voornaam.achternaam@boaportaal.nl." }, 400);
    const { data: huidig } = await poort.sb.from("boa_medewerker").select("user_id, client_id, pv_naam").eq("client_id", cid).maybeSingle();
    if (!huidig) return json({ fout: "Geen medewerker met die Client-ID." }, 404);
    const rol = body.rol === "beheerder" ? "beheerder" : "support";
    const kern = await poort.sb.from("boa_medewerker").update({
      pv_naam: pv || huidig.pv_naam,
      rol,
      actief: Boolean(body.actief),
    }).eq("client_id", cid);
    if (kern.error) return json({ fout: `Het profiel is niet opgeslagen. ${kern.error.message}` }, 500);
    const vlaggen = await poort.sb.from("boa_medewerker").update({
      whatsapp: Boolean(body.whatsapp),
      mag_feit: Boolean(body.feit),
      mag_boom: Boolean(body.boom),
      mag_jargon: Boolean(body.jargon),
      mag_trainer: Boolean(body.trainer),
    }).eq("client_id", cid);
    if (vlaggen.error && !/column|schema cache/i.test(vlaggen.error.message)) {
      return json({ fout: `Het profiel is niet opgeslagen. ${vlaggen.error.message}` }, 500);
    }
    const ident = await poort.sb.from("boa_identiteit").update({ pv_naam: pv || huidig.pv_naam }).eq("user_id", huidig.user_id);
    if (ident.error) return json({ fout: `De naam is niet bijgewerkt. ${ident.error.message}` }, 500);
    if (postbus) {
      const user = await poort.sb.auth.admin.getUserById(huidig.user_id);
      const meta = user.data?.user?.user_metadata || {};
      const huidigLocal = String(meta.mail_local || "").toLowerCase();
      const local = !huidigLocal || isClientPostbus(huidigLocal) ? postbus : huidigLocal;
      const bijgewerkt = await poort.sb.auth.admin.updateUserById(huidig.user_id, {
        user_metadata: {
          ...meta,
          mail_local: local,
          voornaam: String(body.voornaam || "").trim(),
          achternaam: String(body.achternaam || "").trim(),
        },
      });
      if (bijgewerkt.error) return json({ fout: "De postbus is niet gekoppeld." }, 500);
      await poort.sb.from("boa_mail_adres").upsert({
        local,
        voornaam: String(body.voornaam || "").trim(),
        achternaam: String(body.achternaam || "").trim(),
        zoek_naam: true,
        bijgewerkt: new Date().toISOString(),
      });
      if (local !== huidigLocal) {
        const vers = nieuwPostbusWachtwoord();
        const post = await maakPostbus({ local, password: vers });
        if (!post.ok) return json({ fout: post.fout || "De postbus is niet aangemaakt." }, 500);
        const mail = user.data?.user?.email;
        if (mail) await verstuurPostbusWachtwoord({ naar: mail, naam: pv || huidig.pv_naam, local, wachtwoordPostbus: vers });
      }
    }
    await poort.sb.from("boa_audit").insert({
      beheerder_id: poort.med.client_id,
      beheerder_naam: "hoofdbeheerder",
      doel_client_id: cid,
      doel_pv_naam: pv || huidig.pv_naam,
      ticketnummer: "",
      reden: reden.slice(0, 240),
      soort: "CRITICAL_AUTH_CHANGE",
      niveau: "CRITICAL",
    });
    return json({ ok: true });
  }
  if (body.actie === "weg") {
    const cid = String(body.client_id || "").trim().toUpperCase();
    const reden = String(body.reden || "").trim();
    if (!/^BP-\d{4}-[A-Z]{2}$/.test(cid)) return json({ fout: "Geen geldige Client-ID." }, 400);
    if (reden.length < 12) return json({ fout: "De reden is te kort." }, 400);
    if (cid === poort.med.client_id) return json({ fout: "Je kunt jezelf niet als medewerker verwijderen." }, 400);
    const { data: huidig } = await poort.sb.from("boa_medewerker").select("user_id, client_id, pv_naam").eq("client_id", cid).maybeSingle();
    if (!huidig) return json({ fout: "Geen medewerker met die Client-ID." }, 404);
    const user = await poort.sb.auth.admin.getUserById(huidig.user_id);
    const meta = { ...(user.data?.user?.user_metadata || {}) };
    const local = String(meta.mail_local || huidig.client_id || "").toLowerCase();
    delete meta.mail_local;
    delete meta.rol;
    if (user.data?.user) await poort.sb.auth.admin.updateUserById(huidig.user_id, { user_metadata: meta });
    const { error } = await poort.sb.from("boa_medewerker").delete().eq("client_id", cid);
    if (error) return json({ fout: "De medewerker is niet verwijderd." }, 500);
    const post = await verwijderPostbus(local);
    await poort.sb.from("boa_audit").insert({
      beheerder_id: poort.med.client_id,
      beheerder_naam: "hoofdbeheerder",
      doel_client_id: cid,
      doel_pv_naam: huidig.pv_naam,
      ticketnummer: "",
      reden: reden.slice(0, 240),
      soort: "CRITICAL_AUTH_CHANGE",
      niveau: "CRITICAL",
    });
    return json({ ok: true, postbus: post.ok ? "" : post.fout });
  }
  if (body.actie === "postbus-wachtwoord") {
    const cid = String(body.client_id || "").trim().toUpperCase();
    if (!/^BP-\d{4}-[A-Z]{2}$/.test(cid)) return json({ fout: "Geen geldige Client-ID." }, 400);
    const { data: huidig } = await poort.sb.from("boa_medewerker").select("user_id, client_id, pv_naam").eq("client_id", cid).maybeSingle();
    if (!huidig) return json({ fout: "Geen medewerker met die Client-ID." }, 404);
    const user = await poort.sb.auth.admin.getUserById(huidig.user_id);
    const account = user.data?.user;
    if (!account?.email) return json({ fout: "Dit account heeft geen zakelijk adres. De mail kan niet weg." }, 400);
    const meta = account.user_metadata || {};
    const local = String(meta.mail_local || huidig.client_id || "").toLowerCase();
    const wachtwoord = nieuwPostbusWachtwoord();
    const post = await zetPostbusWachtwoord({ local, password: wachtwoord });
    if (!post.ok) return json({ fout: post.fout || "Het postbuswachtwoord is niet gezet." }, 500);
    await poort.sb.auth.admin.updateUserById(account.id, {
      user_metadata: { ...meta, mail_local: local, client_id: huidig.client_id, mail_moet_wijzigen: true },
    });
    let mail = false;
    let mailFout = "";
    try {
      const verzonden = await verstuurPostbusWachtwoord({ naar: account.email, naam: huidig.pv_naam, local, wachtwoordPostbus: wachtwoord });
      mail = Boolean(verzonden.ok);
      mailFout = verzonden.fout || "";
    } catch (err) {
      mailFout = err?.message || "De mail is niet verstuurd.";
    }
    await poort.sb.from("boa_audit").insert({
      beheerder_id: poort.med.client_id,
      beheerder_naam: "hoofdbeheerder",
      doel_client_id: cid,
      doel_pv_naam: huidig.pv_naam,
      ticketnummer: "",
      reden: `Tijdelijk postbuswachtwoord gemaild naar het zakelijke adres.${mail ? "" : ` Mail niet verstuurd: ${mailFout}`}`.slice(0, 240),
      soort: "CRITICAL_AUTH_CHANGE",
      niveau: "CRITICAL",
    });
    if (!mail) return json({ fout: mailFout || "Het wachtwoord is gezet, maar de mail is niet verstuurd." }, 500);
    return json({ ok: true, local });
  }
  if (body.actie === "whatsapp") {
    const cid = String(body.sleutel || "").trim().toUpperCase();
    if (!/^BP-\d{4}-[A-Z]{2}$/.test(cid)) return json({ fout: "Vul een Client-ID in." }, 400);
    const { data, error } = await poort.sb.from("boa_medewerker").update({ whatsapp: Boolean(body.aan) }).eq("client_id", cid).select("client_id, pv_naam, whatsapp").maybeSingle();
    if (error || !data) return json({ fout: "Geen medewerker met die Client-ID. Eerst uitnodigen voor de medewerkersportalen." }, 404);
    await poort.sb.from("boa_audit").insert({
      beheerder_id: poort.med.client_id,
      beheerder_naam: "hoofdbeheerder",
      doel_client_id: data.client_id,
      doel_pv_naam: data.pv_naam,
      ticketnummer: "",
      reden: data.whatsapp ? "WhatsApp-toegang aangezet" : "WhatsApp-toegang uitgezet",
      soort: "WHATSAPP_ROL",
      niveau: "CRITICAL",
    });
    return json(data);
  }
  if (body.actie === "factor-weg") {
    const cid = String(body.client_id || "").trim().toUpperCase();
    const reden = String(body.reden || "").trim();
    if (!/^BP-\d{4}-[A-Z]{2}$/.test(cid)) return json({ fout: "Geen geldige Client-ID." }, 400);
    if (reden.length < 12) return json({ fout: "De reden is te kort." }, 400);
    const { data: ident } = await poort.sb.from("boa_identiteit").select("user_id, pv_naam").eq("client_id", cid).maybeSingle();
    if (!ident?.user_id) return json({ fout: "Geen account met die Client-ID." }, 404);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const lijst = await fetch(`${url}/auth/v1/admin/users/${ident.user_id}/factors`, {
      headers: { authorization: `Bearer ${key}`, apikey: key },
    });
    const ruw = await lijst.json().catch(() => []);
    const factors = Array.isArray(ruw) ? ruw : [];
    for (const factor of factors) {
      await fetch(`${url}/auth/v1/admin/users/${ident.user_id}/factors/${factor.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${key}`, apikey: key },
      });
    }
    await poort.sb.from("boa_audit").insert({
      beheerder_id: poort.med.client_id,
      beheerder_naam: "hoofdbeheerder",
      doel_client_id: cid,
      doel_pv_naam: ident.pv_naam || "",
      ticketnummer: "",
      reden: reden.slice(0, 240),
      soort: "CRITICAL_AUTH_CHANGE",
      niveau: "CRITICAL",
    });
    return json({ ok: true, aantal: factors.length });
  }
  if (body.actie === "redactie") {
    const cid = String(body.sleutel || "").trim().toUpperCase();
    if (!/^BP-\d{4}-[A-Z]{2}$/.test(cid)) return json({ fout: "Vul een Client-ID in." }, 400);
    const { data: huidig } = await poort.sb.from("boa_medewerker").select("user_id, client_id, pv_naam, mag_feit, mag_boom, mag_jargon, mag_trainer").eq("client_id", cid).maybeSingle();
    if (!huidig) return json({ fout: "Geen medewerker met die Client-ID." }, 404);
    const vlaggen = {
      mag_feit: Boolean(body.feit),
      mag_boom: Boolean(body.boom),
      mag_jargon: Boolean(body.jargon),
      mag_trainer: Boolean(body.trainer),
    };
    const { data, error } = await poort.sb.from("boa_medewerker").update(vlaggen).eq("client_id", cid).select("user_id, client_id, pv_naam, mag_feit, mag_boom, mag_jargon, mag_trainer").maybeSingle();
    if (error || !data) return json({ fout: error ? "Draai schema-0014.sql in Supabase." : "Geen medewerker met die Client-ID." }, error ? 500 : 404);
    const delen = [
      ["mag_feit", "Feitcodes", "https://feitcode.boaportaal.nl", "Je mag feitcodes voorleggen die op het portaal staan. De akte en het Feitenboekje gaan voor."],
      ["mag_boom", "Beslisbomen", "https://beslisboom.boaportaal.nl", "Je mag een beslisboom voorleggen. Het blijft een geheugensteun. De akte en de wet gaan voor."],
      ["mag_jargon", "Vakjargon", "https://vakjargon.boaportaal.nl", "Je mag een begrip voorleggen. Kort houden, en alleen wat klopt met de wet of het Feitenboekje."],
      ["mag_trainer", "Trainer", "https://trainer.boaportaal.nl", "Je mag een oefenvraag, een beginsel of een casus voorleggen. Het antwoord blijft de wettekst volgen."],
    ];
    const nieuw = delen.filter(([veld]) => data[veld] && !huidig[veld]);
    const mails = [];
    let mailFout = "";
    if (nieuw.length) {
      const gebruiker = await poort.sb.auth.admin.getUserById(data.user_id);
      const email = gebruiker.data?.user?.email || "";
      if (!email) mailFout = "Geen zakelijk adres gevonden. Het recht staat aan, de uitnodiging is niet verstuurd.";
      else {
        for (const [, titel, url, uitleg] of nieuw) {
          try {
            const verzonden = await verstuurRedactie({ naar: email, naam: data.pv_naam, titel, url, uitleg });
            if (verzonden.ok) mails.push(titel);
            else mailFout = verzonden.fout || "De uitnodiging is niet verstuurd.";
          } catch {
            mailFout = "De uitnodiging is niet verstuurd. Controleer het wachtwoord van onboarding@boaportaal.nl op de systeem-site.";
          }
        }
      }
    }
    const aan = [
      data.mag_feit ? "feitcodes aan" : "feitcodes uit",
      data.mag_boom ? "beslisbomen aan" : "beslisbomen uit",
      data.mag_jargon ? "vakjargon aan" : "vakjargon uit",
      data.mag_trainer ? "trainer aan" : "trainer uit",
    ].join(", ");
    await poort.sb.from("boa_audit").insert({
      beheerder_id: poort.med.client_id,
      beheerder_naam: "hoofdbeheerder",
      doel_client_id: data.client_id,
      doel_pv_naam: data.pv_naam,
      ticketnummer: "",
      reden: `Redactierecht gezet voor ${data.pv_naam} ${data.client_id}: ${aan}.${mails.length ? ` Uitnodiging verstuurd voor ${mails.join(", ")}.` : ""}`,
      soort: "REDACTIE_RECHT",
      niveau: "HIGH",
      bron: "systeem",
    });
    return json({ ...data, mails, mailFout });
  }
  const sleutel = String(body.sleutel || body.email || "").trim();
  const rol = body.rol === "beheerder" ? "beheerder" : "support";

  let user = null;
  let pv = naarPv(body.pv_naam);
  if (/^BP-\d{4}-[A-Z]{2}$/i.test(sleutel)) {
    const cid = sleutel.toUpperCase();
    const { data: ident } = await poort.sb.from("boa_identiteit").select("user_id, client_id, pv_naam").eq("client_id", cid).maybeSingle();
    if (!ident?.user_id) return json({ fout: "Geen account met die Client-ID." }, 404);
    const opgehaald = await poort.sb.auth.admin.getUserById(ident.user_id);
    if (opgehaald.error || !opgehaald.data.user?.email) return json({ fout: "Dit account heeft geen zakelijk adres. De uitnodiging kan niet weg." }, 400);
    user = opgehaald.data.user;
    pv = ident.pv_naam;
  } else if (sleutel.includes("@")) {
    const email = sleutel.toLowerCase();
    user = await zoekEmail(poort.sb, email);
    if (!user) {
      const password = String(body.password || "");
      if (password.length < 12 || pv.length < 3) return json({ fout: "Nieuw adres: vul een PV-naam en een startwachtwoord van minstens 12 tekens in." }, 400);
      const gemaakt = await poort.sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { naam: pv, rol } });
      if (gemaakt.error || !gemaakt.data.user) return json({ fout: gemaakt.error?.message || "Account niet aangemaakt." }, 400);
      user = gemaakt.data.user;
    }
  } else {
    return json({ fout: "Vul een Client-ID of een e-mailadres in." }, 400);
  }

  const ident = await zorgIdentiteit(poort.sb, user, pv);
  if (!ident?.client_id) return json({ fout: "Client-ID niet uitgegeven." }, 500);
  pv = ident.pv_naam || pv;
  const basis = { user_id: user.id, client_id: ident.client_id, pv_naam: pv, rol, actief: true };
  const { error: medFout } = await poort.sb.from("boa_medewerker").upsert(basis, { onConflict: "user_id" });
  if (medFout) return json({ fout: `Medewerkersrol niet gekoppeld: ${medFout.message}` }, 500);
  await poort.sb.from("boa_medewerker").update({
    whatsapp: Boolean(body.whatsapp),
    mag_feit: Boolean(body.feit),
    mag_boom: Boolean(body.boom),
    mag_jargon: Boolean(body.jargon),
    mag_trainer: Boolean(body.trainer),
  }).eq("user_id", user.id);
  const voornaam = String(body.voornaam || user.user_metadata?.voornaam || "").trim();
  const achternaam = String(body.achternaam || user.user_metadata?.achternaam || "").trim();
  const gewenst = mailLocalVan(voornaam, achternaam);
  const bestaand = String(user.user_metadata?.mail_local || "").toLowerCase();
  const local = bestaand && !isClientPostbus(bestaand) ? bestaand : gewenst;
  if (!local) return json({ fout: "Vul voornaam en achternaam in. Het mailadres wordt voornaam.achternaam@boaportaal.nl." }, 400);
  let mailboxPass = String(body.password || "");
  let vers = "";
  if (mailboxPass.length < 12) {
    mailboxPass = nieuwPostbusWachtwoord();
    vers = mailboxPass;
  }
  await poort.sb.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata || {}), naam: pv, rol, mail_local: local, voornaam, achternaam, client_id: ident.client_id, mail_moet_wijzigen: Boolean(vers) },
  });
  await poort.sb.from("boa_mail_adres").upsert({
    local,
    voornaam,
    achternaam,
    zoek_naam: true,
    bijgewerkt: new Date().toISOString(),
  });
  const post = await maakPostbus({ local, password: mailboxPass });
  if (!post.ok) return json({ fout: post.fout, client_id: ident.client_id }, 500);
  let mail = false;
  let mailFout = "";
  try {
    const verzonden = await verstuurUitnodiging({ naar: user.email, naam: pv, postbus: post.adres, wachtwoordPostbus: vers });
    mail = Boolean(verzonden.ok);
    mailFout = verzonden.fout || "";
  } catch (err) {
    mailFout = err?.message || "De uitnodiging is niet verstuurd. Controleer het wachtwoord van onboarding@boaportaal.nl op de systeem-site.";
  }
  await poort.sb.from("boa_audit").insert({
    beheerder_id: poort.med.client_id,
    beheerder_naam: "hoofdbeheerder",
    doel_client_id: ident.client_id,
    doel_pv_naam: pv,
    ticketnummer: "",
    reden: `Uitgenodigd. Postbus ${post.adres} ${post.nieuw ? "aangemaakt" : "bestond al"}.${mail ? " Mail verstuurd." : ` Mail niet verstuurd: ${mailFout}`}`.slice(0, 240),
    soort: "MEDEWERKER_AANGEMAAKT",
    niveau: "CRITICAL",
  });
  return json({ client_id: ident.client_id, pv_naam: pv, rol, mail, mailFout, postbus: post.adres, wachtwoord: mail ? "" : vers });
};
