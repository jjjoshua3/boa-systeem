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

export async function verstuurUitnodiging({ naar, naam }) {
  const wachtwoord = process.env.PURELYMAIL_ONBOARDING_PASSWORD;
  if (!wachtwoord) {
    return { ok: false, fout: "Zet PURELYMAIL_ONBOARDING_PASSWORD op de Netlify-site van systeem. Dan gaat de uitnodiging vanaf onboarding@boaportaal.nl." };
  }
  const { default: nodemailer } = await import("nodemailer");
  const aanhef = naam ? `Hoi ${naam},` : "Hoi,";
  const links = [
    ["Mail", "https://mail.boaportaal.nl"],
    ["Status", "https://status.boaportaal.nl"],
    ["Servicedesk", "https://servicedesk.boaportaal.nl"],
    ["Systeem", "https://systeem.boaportaal.nl"],
  ];
  const tekst = [
    aanhef,
    "",
    "Je bent uitgenodigd voor de medewerkersportalen van BOA Portaal.",
    "",
    ...links.map(([label, url]) => `${label}: ${url}`),
    "",
    "Op mail.boaportaal.nl log je in met je Client-ID. Die staat in je gebruikersomgeving: https://boaportaal.nl/account",
    "Het wachtwoord is het wachtwoord dat je al hebt, of het startwachtwoord dat je van de beheerder hebt gekregen.",
    "",
    "Groet,",
    "BOA Portaal",
  ].join("\n");
  const items = links.map(([label, url]) => `<li style="margin:6px 0"><a href="${url}" style="color:#1d4ed8">${label}</a><br><span style="color:#475569">${url}</span></li>`).join("");
  const html = `<div style="font-family:Segoe UI,Trebuchet MS,sans-serif;font-size:16px;line-height:1.55;color:#0f172a;max-width:560px">
    <p style="margin:0 0 12px;letter-spacing:.08em;font-size:12px;color:#1d4ed8">BOA PORTAAL</p>
    <h1 style="font-size:22px;margin:0 0 12px">Uitnodiging voor de medewerkersportalen</h1>
    <p>${aanhef}</p>
    <p>Je bent uitgenodigd voor de medewerkersportalen van BOA Portaal.</p>
    <ul style="padding-left:18px">${items}</ul>
    <p>Op mail.boaportaal.nl log je in met je Client-ID. Die staat in je gebruikersomgeving: <a href="https://boaportaal.nl/account" style="color:#1d4ed8">https://boaportaal.nl/account</a></p>
    <p>Het wachtwoord is het wachtwoord dat je al hebt, of het startwachtwoord dat je van de beheerder hebt gekregen.</p>
    <p>Groet,<br>BOA Portaal</p>
  </div>`;
  const smtp = nodemailer.createTransport({
    host: "smtp.purelymail.com",
    port: 465,
    secure: true,
    auth: { user: "onboarding@boaportaal.nl", pass: wachtwoord },
  });
  await smtp.sendMail({
    from: { name: "BOA Portaal", address: "onboarding@boaportaal.nl" },
    to: naar,
    subject: "Uitnodiging voor de medewerkersportalen van BOA Portaal",
    text: tekst,
    html,
  });
  return { ok: true };
}

export async function verstuurRedactie({ naar, naam, titel, url, uitleg }) {
  const wachtwoord = process.env.PURELYMAIL_ONBOARDING_PASSWORD;
  if (!wachtwoord) {
    return { ok: false, fout: "Zet PURELYMAIL_ONBOARDING_PASSWORD op de Netlify-site van systeem. Dan gaat de uitnodiging vanaf onboarding@boaportaal.nl." };
  }
  const { default: nodemailer } = await import("nodemailer");
  const aanhef = naam ? `Hoi ${naam},` : "Hoi,";
  const tekst = [
    aanhef,
    "",
    `Je hebt toegang gekregen tot de redactie voor ${titel}.`,
    "",
    uitleg,
    "",
    "Zo werkt het:",
    "1. Open de link. Inloggen doe je met hetzelfde e-mailadres als waarmee je deze mail ontvangen hebt.",
    "2. Kies de tekst, pas die aan en leg hem voor.",
    "3. De hoofdbeheerder keurt hem goed. Pas daarna staat hij op boaportaal.nl.",
    "",
    url,
    "",
    "Groet,",
    "BOA Portaal",
  ].join("\n");
  const html = `<div style="font-family:Georgia,Segoe UI,sans-serif;font-size:16px;line-height:1.55;color:#0f2537;max-width:560px">
    <p style="margin:0 0 8px;letter-spacing:.14em;font-size:12px;color:#9a5b12">BOA PORTAAL</p>
    <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;margin:0 0 12px">Uitnodiging · ${titel}</h1>
    <p>${aanhef}</p>
    <p>Je hebt toegang gekregen tot de redactie voor ${titel}.</p>
    <p>${uitleg}</p>
    <p style="margin:18px 0"><a href="${url}" style="display:inline-block;background:#0f2537;color:#fff;text-decoration:none;border-radius:12px;padding:10px 16px">${titel} openen</a></p>
    <p style="color:#4b5563;font-size:14px">${url}</p>
    <p><b>Zo werkt het</b></p>
    <ol style="padding-left:18px;color:#0f2537">
      <li>Open de link. Inloggen doe je met hetzelfde e-mailadres als waarmee je deze mail ontvangen hebt.</li>
      <li>Kies de tekst, pas die aan en leg hem voor.</li>
      <li>De hoofdbeheerder keurt hem goed. Pas daarna staat hij op boaportaal.nl.</li>
    </ol>
    <p>Groet,<br>BOA Portaal</p>
  </div>`;
  const smtp = nodemailer.createTransport({
    host: "smtp.purelymail.com",
    port: 465,
    secure: true,
    auth: { user: "onboarding@boaportaal.nl", pass: wachtwoord },
  });
  await smtp.sendMail({
    from: { name: "BOA Portaal", address: "onboarding@boaportaal.nl" },
    to: naar,
    subject: `Uitnodiging voor de redactie ${titel}`,
    text: tekst,
    html,
  });
  return { ok: true };
}
