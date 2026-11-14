import { beheerder, json, verstuurUitnodiging } from "./lib.mjs";

function naarPv(raw) {
  const t = String(raw || "").trim().replace(/\s+/g, " ");
  if (t.includes(",")) {
    const [l, r] = t.split(",", 2);
    return `${l.trim().toUpperCase()}, ${String(r || ".").trim().toUpperCase()}`;
  }
  const parts = t.split(" ");
  const last = parts.pop() || "ONBEKEND";
  const init = parts.map((w) => `${w[0].toUpperCase()}.`).join("");
  return `${last.toUpperCase()}, ${init || "."}`;
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
  if (bestaand?.client_id) return bestaand;
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
  const sleutel = String(body.sleutel || body.email || "").trim();
  const rol = body.rol === "beheerder" ? "beheerder" : "support";
  const postbus = String(body.postbus || "").trim().toLowerCase();
  if (postbus && !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(postbus)) return json({ fout: "De postbusnaam mag alleen letters, cijfers, een punt of een streepje." }, 400);

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
  const { data: bestaand } = await poort.sb.from("boa_medewerker").select("user_id").eq("user_id", user.id).maybeSingle();
  const rij = { user_id: user.id, client_id: ident.client_id, pv_naam: pv, rol, actief: true };
  const { error: medFout } = bestaand
    ? await poort.sb.from("boa_medewerker").update({ pv_naam: pv, rol, actief: true }).eq("user_id", user.id)
    : await poort.sb.from("boa_medewerker").insert(rij);
  if (medFout) return json({ fout: "Medewerkersrol niet gekoppeld." }, 500);
  await poort.sb.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata || {}), naam: pv, rol, mail_local: postbus || user.user_metadata?.mail_local || ident.client_id.toLowerCase(), client_id: ident.client_id },
  });
  await poort.sb.from("boa_audit").insert({
    beheerder_id: poort.med.client_id,
    beheerder_naam: "hoofdbeheerder",
    doel_client_id: ident.client_id,
    doel_pv_naam: pv,
    ticketnummer: "",
    reden: "Uitgenodigd voor de medewerkersportalen",
    soort: "MEDEWERKER_AANGEMAAKT",
    niveau: "CRITICAL",
  });
  let mail = false;
  let mailFout = "";
  try {
    const verzonden = await verstuurUitnodiging({ naar: user.email, naam: pv });
    mail = Boolean(verzonden.ok);
    mailFout = verzonden.fout || "";
  } catch {
    mailFout = "De uitnodiging is niet verstuurd. Controleer het wachtwoord van account@boaportaal.nl op de systeem-site.";
  }
  return json({ client_id: ident.client_id, pv_naam: pv, rol, mail, mailFout });
};
