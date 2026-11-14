import { beheerder, json } from "./lib.mjs";

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["beheerder"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const { client_id, locked } = await request.json();
  const { data: ident } = await poort.sb.from("boa_identiteit").select("user_id").eq("client_id", String(client_id).toUpperCase()).maybeSingle();
  if (!ident) return json({ fout: "Onbekende Client-ID." }, 404);
  const { error } = await poort.sb.auth.admin.updateUserById(ident.user_id, { ban_duration: locked ? "876000h" : "none" });
  if (error) return json({ fout: "De aanmeldblokkade is niet gezet." }, 502);
  return json({ ok: true });
};
