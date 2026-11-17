// Contador de visitas do site WordPress (representacoesfreixo.com) por imagem de 1x1.
// O WordPress só deixa a conta de Editor pôr imagens (não scripts), por isso o rodapé tem
// <img src=".../functions/v1/visita-site"> e as páginas de marca podem ter ?m=<marca>&p=<caminho>.
// Não guarda nada no dispositivo do visitante: o identificador é um hash de IP + navegador.
const env = (k: string) => Deno.env.get(k) ?? "";
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headless|curl|wget|python|monitor/i;

const pixel = () => new Response(GIF, {
  headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Access-Control-Allow-Origin": "*" },
});

async function visitorId(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ua = req.headers.get("user-agent") ?? "";
  const data = new TextEncoder().encode(`${ip}|${ua}|${env("SUPABASE_URL")}|freixo-site`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return "s" + Array.from(hash.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || BOT.test(ua)) return pixel();
    const url = new URL(req.url);
    let page = url.searchParams.get("p") ?? "";
    if (!page) {
      try { page = new URL(req.headers.get("referer") ?? "").pathname; } catch { page = ""; }
    }
    page = page.slice(0, 200) || "/";
    const brand = url.searchParams.get("m") ?? page.match(/\/marcas-representadas\/([a-z0-9-]+)/i)?.[1] ?? null;
    await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/b2b_track_visit`, {
      method: "POST",
      headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: `Bearer ${env("SUPABASE_ANON_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_site: "site", p_visitor: await visitorId(req), p_page: page, p_brand: brand?.toLowerCase() ?? null }),
    });
  } catch (_) { /* nunca falhar a imagem */ }
  return pixel();
});
