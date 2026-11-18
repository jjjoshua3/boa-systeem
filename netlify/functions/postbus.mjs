import { json, zetPostbusWachtwoord } from "./lib.mjs";

export default async (request) => {
  if (request.method !== "POST") return json({ fout: "POST" }, 405);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const header = request.headers.get("authorization") || "";
  if (!key || header !== `Bearer ${key}`) return json({ fout: "Geen toegang." }, 401);
  const body = await request.json().catch(() => ({}));
  const local = String(body.local || "").trim().toLowerCase();
  const password = String(body.password || "");
  const domain = body.domain === "ambassadeur.boaportaal.nl" ? body.domain : "boaportaal.nl";
  const uit = await zetPostbusWachtwoord({ local, password, domain });
  if (!uit.ok) return json({ fout: uit.fout || "Het mailwachtwoord is niet gewijzigd." }, 500);
  return json({ ok: true });
};
