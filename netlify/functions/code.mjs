import { admin } from "./lib.mjs";
import zxcvbn from "zxcvbn";

const GRATIS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl",
  "live.com", "live.nl", "msn.com", "yahoo.com", "yahoo.nl", "icloud.com", "me.com",
  "ziggo.nl", "kpnmail.nl", "planet.nl", "hetnet.nl", "chello.nl", "upcmail.nl", "xs4all.nl",
  "online.nl", "telfort.nl", "home.nl", "casema.nl", "quicknet.nl", "proton.me", "protonmail.com",
]);

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

function adresGeldig(email) {
  const stuk = String(email || "").trim().toLowerCase();
  const match = stuk.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  if (!match) return "";
  if (GRATIS.has(match[1])) return "";
  return stuk;
}

function wachtwoordFout(password, extra = []) {
  const tekst = String(password || "");
  if (tekst.length < 12) return "Kies een wachtwoord van minstens 12 tekens. De mailserver eist dat ook.";
  if (tekst.length > 200) return "Het wachtwoord is te lang.";
  const score = zxcvbn(tekst, extra.map((deel) => String(deel || "")).filter((deel) => deel.length > 1));
  const dagen = Math.floor(Number(score?.crack_times_seconds?.offline_fast_hashing_1e10_per_second || 0) / 86400);
  if (dagen < 30) return `Dit wachtwoord is te makkelijk. De mailserver eist minstens 30 dagen kraaktijd. Dit wachtwoord zit op ${dagen} dagen. Gebruik een zin van vier willekeurige woorden.`;
  return "";
}

async function verstuurCode(naar, code, soort) {
  const eigen = process.env.PURELYMAIL_ACCOUNT_PASSWORD;
  const wachtwoord = eigen || process.env.PURELYMAIL_ONBOARDING_PASSWORD;
  const van = eigen ? "account@boaportaal.nl" : "onboarding@boaportaal.nl";
  if (!wachtwoord) {
    return { ok: false, fout: "Zet PURELYMAIL_ACCOUNT_PASSWORD op de Netlify-site van systeem. Dat is het wachtwoord van account@boaportaal.nl." };
  }
  const { default: nodemailer } = await import("nodemailer");
  const onderwerp = soort === "herstel" ? "Code om je wachtwoord te herstellen" : "Code om je account te bevestigen";
  const zin = soort === "herstel"
    ? "Met deze code herstel je het wachtwoord van je account op boaportaal.nl."
    : "Met deze code bevestig je je account op boaportaal.nl.";
  const tekst = `BOA Portaal\n\n${zin}\n\n${code}\n\nVul de code in op de site. Open geen link uit een andere mail: een scanner kan die al verbruiken. De code is kort geldig.\n\nGroet,\nBOA Portaal`;
  const html = `<div style="font-family:Segoe UI,Trebuchet MS,sans-serif;font-size:16px;line-height:1.55;color:#0f172a;max-width:560px">
    <p style="margin:0 0 12px;letter-spacing:.08em;font-size:12px;color:#1d4ed8">BOA PORTAAL</p>
    <h1 style="font-size:22px;margin:0 0 12px">${onderwerp}</h1>
    <p>${zin}</p>
    <p style="font-family:ui-monospace,Consolas,monospace;font-size:32px;letter-spacing:.2em;font-weight:700;margin:18px 0">${code}</p>
    <p>Vul de code in op de site. Open geen link uit een andere mail: een scanner kan die al verbruiken. De code is kort geldig.</p>
    <p>Groet,<br>BOA Portaal</p>
  </div>`;
  const smtp = nodemailer.createTransport({
    host: "smtp.purelymail.com",
    port: 465,
    secure: true,
    auth: { user: van, pass: wachtwoord },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
  await smtp.sendMail({
    from: { name: "BOA Portaal", address: van },
    to: naar,
    subject: onderwerp,
    text: tekst,
    html,
  });
  return { ok: true };
}

export default async (request) => {
  if (request.method === "OPTIONS") return antwoord(request, {}, 204);
  if (request.method !== "POST") return antwoord(request, { fout: "POST" }, 405);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const email = adresGeldig(body.email);
  if (!email) return antwoord(request, { fout: "Gebruik het adres van je gemeente, vervoerder, school of organisatie." }, 400);
  const actie = body.actie === "herstel" ? "herstel" : "signup";
  const sb = admin();
  if (!sb) return antwoord(request, { fout: "De service-sleutel ontbreekt op de server." }, 503);
  let link;
  let type = "signup";
  if (actie === "herstel") {
    link = await sb.auth.admin.generateLink({ type: "recovery", email });
    type = "recovery";
  } else {
    const password = String(body.password || "");
    const zwak = wachtwoordFout(password, [email, body.voornaam, body.achternaam, body.naam]);
    if (zwak) return antwoord(request, { fout: zwak }, 400);
    link = await sb.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: {
          naam: String(body.naam || "").slice(0, 80),
          roep: String(body.roep || "").slice(0, 80),
          voornaam: String(body.voornaam || "").slice(0, 40),
          achternaam: String(body.achternaam || "").slice(0, 40),
          domein: String(body.domein || "").slice(0, 12),
          rol: String(body.rol || "").slice(0, 40),
        },
      },
    });
    if (link.error && /already|registered|exists/i.test(link.error.message || "")) {
      link = await sb.auth.admin.generateLink({ type: "magiclink", email });
      type = "email";
    }
  }
  const code = String(link.data?.properties?.email_otp || "");
  if (link.error || !/^\d{6,10}$/.test(code)) {
    return antwoord(request, { fout: "De code kon niet worden gemaakt. Probeer het opnieuw." }, 502);
  }
  try {
    const verzonden = await verstuurCode(email, code, actie);
    if (!verzonden.ok) return antwoord(request, { fout: verzonden.fout }, 503);
  } catch {
    return antwoord(request, { fout: "De mail ging niet weg. Controleer het wachtwoord van account@boaportaal.nl op de systeem-site." }, 502);
  }
  return antwoord(request, { ok: true, type });
};
