import { admin } from "./lib.mjs";

function koppen(request) {
  const bron = request.headers.get("origin") || "";
  const toegestaan = /^https:\/\/([a-z0-9-]+\.)?boaportaal\.nl$/.test(bron) ? bron : "https://overleg.boaportaal.nl";
  return {
    "content-type": "application/json",
    "access-control-allow-origin": toegestaan,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: koppen(request) });
  if (request.method !== "POST") return new Response(JSON.stringify({ open: false }), { status: 405, headers: koppen(request) });
  const body = await request.json().catch(() => ({}));
  const room = String(body.room || "");
  if (!/^boa[a-z0-9]{10,48}$/.test(room)) {
    return new Response(JSON.stringify({ open: false }), { headers: koppen(request) });
  }
  const sb = admin();
  if (!sb) return new Response(JSON.stringify({ open: false }), { status: 503, headers: koppen(request) });
  const { data } = await sb.from("boa_kanaal").select("id").eq("call_room", room).maybeSingle();
  return new Response(JSON.stringify({ open: Boolean(data) }), { headers: koppen(request) });
}
