import { beheerder, json } from "./lib.mjs";

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const poort = await beheerder(request, ["support", "beheerder"]);
  if (poort.fout) return json({ fout: poort.fout }, poort.status);
  const { verzoek } = await request.json();
  const { data: uid, error } = await poort.sb.rpc("boa_reset_open", { p_id: verzoek });
  if (error || !uid) return json({ fout: "Geen openstaand herstelverzoek." }, 404);
  const { data: account } = await poort.sb.auth.admin.getUserById(uid);
  const email = account?.user?.email;
  if (!email) return json({ fout: "Geen geverifieerd adres gekoppeld." }, 409);
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) return json({ fout: "De herstelmail is niet vertrokken." }, 502);
  await poort.sb.rpc("boa_reset_klaar", { p_id: verzoek });
  return json({ ok: true });
};
