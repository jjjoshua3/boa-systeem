import { beheerder, json } from "./lib.mjs";

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const body = await request.json();
  const clientId = String(body.client_id || "").trim().toUpperCase();
  const postbus = String(body.postbus || "").trim().toLowerCase();
  const reden = String(body.reden || "").trim();
  if (!/^BP-\d{4}-[A-Z]{2}$/.test(clientId)) return json({ fout: "Onbekende Client-ID." }, 400);
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(postbus)) return json({ fout: "De postbusnaam mag alleen letters, cijfers, een punt of een streepje." }, 400);
  if (reden.length < 12) return json({ fout: "Een reden van minstens 12 tekens is verplicht." }, 400);
  const { data: identiteit } = await poort.sb.from("boa_identiteit").select("user_id, pv_naam").eq("client_id", clientId).maybeSingle();
  if (!identiteit?.user_id) return json({ fout: "Geen account bij deze Client-ID." }, 404);
  const huidig = await poort.sb.auth.admin.getUserById(identiteit.user_id);
  if (huidig.error || !huidig.data.user) return json({ fout: "Het account is niet gevonden." }, 404);
  const meta = { ...(huidig.data.user.user_metadata || {}), mail_local: postbus, client_id: clientId };
  const bijgewerkt = await poort.sb.auth.admin.updateUserById(identiteit.user_id, { user_metadata: meta });
  if (bijgewerkt.error) return json({ fout: "De postbus kon niet worden gekoppeld." }, 500);
  await poort.sb.from("boa_audit").insert({
    beheerder_id: poort.med.client_id,
    beheerder_naam: "hoofdbeheerder",
    doel_client_id: clientId,
    doel_pv_naam: identiteit.pv_naam || "",
    ticketnummer: "",
    reden,
    soort: "POSTBUS_GEKOPPELD",
    niveau: "CRITICAL",
  });
  return json({ ok: true, postbus });
};
