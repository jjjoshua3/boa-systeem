import { beheerder, json } from "./lib.mjs";

const LEEG = { mislukt: 0, mislukt_sinds: null, slot_tot: null, slot_straf: false };

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder", "support"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const body = await request.json().catch(() => ({}));
  const clientId = String(body.client_id || "").toUpperCase();
  let { data: ident, error: leesFout } = await poort.sb.from("boa_identiteit").select("user_id, pv_naam, locked, mislukt, slot_tot, slot_straf").eq("client_id", clientId).maybeSingle();
  if (leesFout) {
    const basis = await poort.sb.from("boa_identiteit").select("user_id, pv_naam, locked").eq("client_id", clientId).maybeSingle();
    ident = basis.data;
  }
  if (!ident) return json({ fout: "Onbekende Client-ID." }, 404);
  if (body.actie === "status") {
    return json({
      locked: Boolean(ident.locked),
      mislukt: ident.mislukt || 0,
      slot_tot: ident.slot_tot || null,
      slot_straf: Boolean(ident.slot_straf),
    });
  }
  const locked = Boolean(body.locked);
  if (locked && poort.med.rol !== "beheerder") return json({ fout: "Handmatig vergrendelen is alleen voor de hoofdbeheerder." }, 403);
  const velden = { locked, ...LEEG };
  let update = await poort.sb.from("boa_identiteit").update(velden).eq("user_id", ident.user_id);
  if (update.error) update = await poort.sb.from("boa_identiteit").update({ locked }).eq("user_id", ident.user_id);
  if (update.error) return json({ fout: "Draai schema-0011.sql in Supabase." }, 500);
  const { error } = await poort.sb.auth.admin.updateUserById(ident.user_id, { ban_duration: locked ? "876000h" : "none" });
  if (error) return json({ fout: "De aanmeldblokkade is niet gezet." }, 502);
  const reden = String(body.reden || "").trim() || (locked ? "Handmatig vergrendeld door hoofdbeheerder" : "Ontgrendeld na ticket");
  await poort.sb.from("boa_audit").insert({
    beheerder_id: poort.med.client_id,
    beheerder_naam: poort.med.client_id,
    doel_client_id: clientId,
    doel_pv_naam: ident.pv_naam || "",
    ticketnummer: "",
    reden: reden.slice(0, 240),
    soort: "CRITICAL_AUTH_CHANGE",
    niveau: "CRITICAL",
    bron: "systeem",
  }).then(() => null, () => null);
  return json({ ok: true, locked });
};

