import { beheerder, json } from "./lib.mjs";

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

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const rol = body.rol === "beheerder" ? "beheerder" : "support";
  const pv = naarPv(body.pv_naam);
  if (!email.includes("@") || password.length < 12 || pv.length < 3) return json({ fout: "Gegevens onvolledig." }, 400);
  const gemaakt = await poort.sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { naam: pv, rol } });
  if (gemaakt.error || !gemaakt.data.user) return json({ fout: gemaakt.error?.message || "Account niet aangemaakt." }, 400);
  let cid = clientId();
  for (let i = 0; i < 5; i += 1) {
    const { error } = await poort.sb.from("boa_identiteit").insert({ user_id: gemaakt.data.user.id, client_id: cid, pv_naam: pv });
    if (!error) break;
    cid = clientId();
    if (i === 4) return json({ fout: "Client-ID niet uitgegeven." }, 500);
  }
  const { error: medFout } = await poort.sb.from("boa_medewerker").insert({ user_id: gemaakt.data.user.id, client_id: cid, pv_naam: pv, rol });
  if (medFout) return json({ fout: "Medewerkersrol niet gekoppeld." }, 500);
  await poort.sb.from("boa_audit").insert({
    beheerder_id: poort.med.client_id,
    beheerder_naam: "hoofdbeheerder",
    doel_client_id: cid,
    doel_pv_naam: pv,
    ticketnummer: "",
    reden: "Medewerkersaccount aangemaakt",
    soort: "MEDEWERKER_AANGEMAAKT",
    niveau: "CRITICAL",
  });
  return json({ client_id: cid, pv_naam: pv, rol });
};
