import { admin } from "./lib.mjs";

function koppen(request) {
  const bron = request.headers.get("origin") || "";
  const toegestaan = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(bron) ? bron : "https://boaportaal.nl";
  return {
    "content-type": "application/json",
    "access-control-allow-origin": toegestaan,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, OPTIONS",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: koppen(request) });
  const sb = admin();
  if (!sb) return new Response(JSON.stringify({ regels: [] }), { headers: koppen(request) });
  const { data } = await sb.from("boa_inhoud").select("soort, sleutel, payload");
  return new Response(JSON.stringify({ regels: data || [] }), { headers: koppen(request) });
}
