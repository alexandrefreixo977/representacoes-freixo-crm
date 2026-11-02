// Loja B2B → clientes do CRM. A equipa da loja (gestão e comerciais), nas propostas e nas encomendas em nome de clientes,
// procura os clientes na base de dados do CRM. Autentica com a sessão da LOJA (token do Supabase da loja) e só aceita
// utilizadores com papel admin ou comercial. POST garante o cliente na loja (liga pelo NIF ou cria com os dados do CRM).
import { normalizeNif } from "../../../b2b-link";
import { B2BError, crmAdmin, linkedShopClient, shopAdmin, type CrmClient } from "../server";
export const dynamic = "force-dynamic";

const ORIGINS = ["https://b2b.representacoesfreixo.com", "https://encomendas.representacoesfreixo.com", "https://freixo-b2b.pages.dev"];
function cors(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const ok = ORIGINS.includes(origin) || origin.endsWith(".freixo-b2b.pages.dev") || /^http:\/\/localhost:\d+$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}
const reply = (request: Request, data: unknown, status = 200) => Response.json(data, { status, headers: cors(request) });
function fail(request: Request, error: unknown) {
  const message = error instanceof Error ? error.message : "Não foi possível contactar o CRM.";
  return reply(request, { error: message }, error instanceof B2BError ? error.status : 500);
}

/** Utilizador da loja com sessão e papel de equipa (admin ou comercial). */
async function shopStaff(request: Request) {
  const jwt = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!jwt) throw new B2BError(401, "Inicie sessão na loja.");
  const shop = shopAdmin();
  const { data: { user }, error } = await shop.auth.getUser(jwt);
  if (error || !user) throw new B2BError(401, "A sessão da loja expirou. Entre novamente.");
  const role = await shop.from("b2b_users").select("role").eq("user_id", user.id).maybeSingle();
  if (role.data?.role !== "admin" && role.data?.role !== "comercial") throw new B2BError(403, "Reservado à equipa Freixo.");
  return shop;
}

const COLS = "id,trade_name,legal_name,tax_id,email,phone,address,postal_code,city";
type Row = CrmClient & { legal_name: string | null };
const addressOf = (c: CrmClient) => [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request) });
}

/** ?q=texto → até 30 clientes do CRM (nome comercial, nome legal, NIF ou email), com o cliente da loja ligado, se existir. */
export async function GET(request: Request) {
  try {
    const shop = await shopStaff(request);
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
    if (q.length < 2) return reply(request, { clients: [] });
    const like = `%${q.replace(/[%_,()\\]/g, " ")}%`;
    const nif = normalizeNif(q);
    const filters = [`trade_name.ilike.${like}`, `legal_name.ilike.${like}`, `email.ilike.${like}`];
    if (nif.length >= 3) filters.push(`tax_id.ilike.%${nif}%`);
    const found = await crmAdmin().from("clients").select(COLS).is("archived_at", null).or(filters.join(",")).order("trade_name").limit(30);
    if (found.error) throw new B2BError(502, found.error.message);
    const rows = (found.data ?? []) as Row[];
    const links = rows.length
      ? await shop.from("b2b_clients").select("id,nif,crm_client_id")
      : { data: [], error: null };
    if (links.error) throw new B2BError(502, links.error.message);
    const byCrm = new Map((links.data ?? []).filter((s: any) => s.crm_client_id).map((s: any) => [s.crm_client_id, s.id]));
    const byNif = new Map((links.data ?? []).filter((s: any) => !s.crm_client_id && normalizeNif(s.nif)).map((s: any) => [normalizeNif(s.nif), s.id]));
    return reply(request, {
      clients: rows.map(c => ({
        crmId: c.id,
        name: c.trade_name,
        legalName: c.legal_name,
        nif: c.tax_id,
        email: c.email,
        phone: c.phone,
        address: addressOf(c),
        shopClientId: byCrm.get(c.id) ?? byNif.get(normalizeNif(c.tax_id)) ?? null,
      })),
    });
  } catch (error) { return fail(request, error); }
}

/** { crmId } → cliente da loja ligado a este cliente do CRM (liga pelo NIF ou cria-o com os dados do CRM). Não envia convites. */
export async function POST(request: Request) {
  try {
    const shop = await shopStaff(request);
    const body = await request.json().catch(() => ({})) as { crmId?: string };
    if (!body.crmId || !/^[0-9a-f-]{36}$/i.test(body.crmId)) throw new B2BError(400, "Cliente inválido.");
    const crm = await crmAdmin().from("clients").select(COLS).eq("id", body.crmId).is("archived_at", null).maybeSingle();
    if (crm.error || !crm.data) throw new B2BError(404, "Cliente não encontrado no CRM.");
    const client = crm.data as Row;
    let linked = await linkedShopClient(shop, client);
    if (!linked) {
      const created = await shop.from("b2b_clients")
        .insert({ name: client.trade_name, nif: client.tax_id, email: client.email, phone: client.phone, address: addressOf(client), crm_client_id: client.id })
        .select("id").single();
      if (created.error) throw new B2BError(502, created.error.message);
      linked = { id: created.data.id, name: client.trade_name, nif: client.tax_id, crm_client_id: client.id };
    }
    const full = await shop.from("b2b_clients").select("id,name,nif,email,phone,address").eq("id", linked.id).single();
    if (full.error) throw new B2BError(502, full.error.message);
    return reply(request, { client: full.data });
  } catch (error) { return fail(request, error); }
}
