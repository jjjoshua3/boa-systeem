import { createClient } from "@supabase/supabase-js";
import { beheerder, json } from "./lib.mjs";

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const body = await request.json().catch(() => ({}));
  const reden = String(body.reden || "").trim();
  const wachtwoord = String(body.password || "");
  const clientId = String(body.client_id || "").trim().toUpperCase();
  if (reden.length < 12) return json({ fout: "Reden is verplicht, minimaal 12 tekens." }, 400);
  if (wachtwoord.length < 12) return json({ fout: "Het wachtwoord moet minimaal 12 tekens zijn." }, 400);
  const { data: ident } = await poort.sb.from("boa_identiteit").select("user_id, pv_naam").eq("client_id", clientId).maybeSingle();
  if (!ident?.user_id) return json({ fout: "Onbekende Client-ID." }, 404);
  const { error } = await poort.sb.auth.admin.updateUserById(ident.user_id, { password: wachtwoord });
  if (error) return json({ fout: "Het wachtwoord is niet gezet." }, 400);
  const url = process.env.SUPABASE_URL;
  const anon = "sb_publishable_x8nU8ype6b1KOL6K8lS2Iw_DDjz4Olr";
  const als = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: request.headers.get("authorization") || "" } },
  });
  await als.rpc("boa_audit_schrijf", {
    p_soort: "CRITICAL_AUTH_CHANGE",
    p_niveau: "CRITICAL",
    p_reden: `Wachtwoord direct gezet door hoofdbeheerder. ${reden} Het wachtwoord staat niet in dit log.`,
    p_doel_client: clientId,
    p_doel_naam: ident.pv_naam,
    p_ticket: "",
  });
  return json({ ok: true });
};
