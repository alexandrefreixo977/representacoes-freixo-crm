// Envia email quando um cliente submete uma encomenda:
//  - para a Representações Freixo (NOTIFY_TO), com todas as encomendas por fabricante, para validar;
//  - para o cliente, com a confirmação de receção.
// Envio pelo Microsoft 365 (Graph, credenciais de aplicação), a partir da caixa MAIL_FROM.
// Segredos: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM, NOTIFY_TO, APP_URL
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const env = (k: string) => Deno.env.get(k) ?? "";
// Chaves: as que o GitHub Actions configura (B2B_SERVICE_KEY) ou as que o Supabase injeta por omissão.
const serviceKey = () => env("B2B_SERVICE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = (req: Request) => env("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const eur = (n: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function graphToken() {
  const res = await fetch(`https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: env("MS_CLIENT_ID"),
      client_secret: env("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token as string;
}

async function sendMail(token: string, to: string[], subject: string, html: string) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env("MAIL_FROM"))}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { subject, body: { contentType: "HTML", content: html }, toRecipients: to.map((address) => ({ emailAddress: { address } })) },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`sendMail ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { groupId } = await req.json();
    // Cliente autenticado: só pode notificar uma encomenda que seja sua.
    const userClient = createClient(env("SUPABASE_URL"), anonKey(req), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: group } = await userClient.from("b2b_order_groups").select("id").eq("id", groupId).maybeSingle();
    if (!group) return new Response("not found", { status: 404, headers: cors });

    const admin = createClient(env("SUPABASE_URL"), serviceKey());
    const { data: g, error } = await admin
      .from("b2b_order_groups")
      .select("number, customer_ref, notes, created_at, user_id, b2b_clients(name, nif, email, address), b2b_orders(number, subtotal, b2b_manufacturers(name), b2b_order_lines(reference, designation, qty, sales_unit, net_price, line_total))")
      .eq("id", groupId)
      .single();
    if (error || !g) throw new Error(error?.message ?? "sem dados");
    const { data: user } = await admin.auth.admin.getUserById(g.user_id);

    const orders = (g.b2b_orders ?? []).sort((a: any, b: any) => a.number.localeCompare(b.number));
    const total = orders.reduce((s: number, o: any) => s + Number(o.subtotal), 0);
    const tables = orders
      .map(
        (o: any) => `<h3 style="font-family:Georgia,serif;color:#15314c;margin:22px 0 6px">${esc(o.number)} · ${esc(o.b2b_manufacturers?.name)} · ${eur(o.subtotal)}</h3>
<table cellpadding="6" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif">
<tr style="background:#f3f6f8;text-align:left"><th>Ref.</th><th>Designação</th><th align="right">Qtd.</th><th align="right">P. líquido</th><th align="right">Total</th></tr>
${o.b2b_order_lines.map((l: any) => `<tr style="border-top:1px solid #dbe4ea"><td>${esc(l.reference)}</td><td>${esc(l.designation)}</td><td align="right">${Number(l.qty)} ${esc(l.sales_unit)}</td><td align="right">${eur(l.net_price)}</td><td align="right">${eur(l.line_total)}</td></tr>`).join("")}
</table>`
      )
      .join("");
    const c = g.b2b_clients as any;
    const head = `<p style="font:14px Arial,sans-serif"><strong>${esc(c?.name)}</strong>${c?.nif ? ` · NIF ${esc(c.nif)}` : ""}<br>
Pedido por ${esc(user?.user?.email)}${g.customer_ref ? ` · Ref. cliente ${esc(g.customer_ref)}` : ""}${g.notes ? `<br>Observações: ${esc(g.notes)}` : ""}</p>`;
    const foot = `<p style="font:15px Arial,sans-serif;margin-top:18px"><strong>Total s/ IVA: ${eur(total)}</strong></p>`;

    const token = await graphToken();
    await sendMail(
      token,
      env("NOTIFY_TO").split(",").map((s) => s.trim()).filter(Boolean),
      `Nova encomenda ${g.number} · ${c?.name} · ${eur(total)}`,
      `${head}${tables}${foot}<p><a href="${env("APP_URL")}/#/gestao">Abrir a área de gestão para validar</a></p>`
    );
    const clientEmail = user?.user?.email;
    if (clientEmail) {
      await sendMail(
        token,
        [clientEmail],
        `Recebemos a sua encomenda ${g.number}`,
        `<p style="font:14px Arial,sans-serif">Obrigado pela sua encomenda. Vamos validá-la e encaminhá-la ${orders.length > 1 ? "aos fabricantes" : "ao fabricante"}; daremos notícias em breve.</p>${tables}${foot}<p style="font:13px Arial,sans-serif;color:#5d7385">Representações Freixo · Viana do Castelo</p>`
      );
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
