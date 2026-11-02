// Acesso do CRM à loja B2B. Corre só no servidor: usa a chave de serviço da loja e a do CRM.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeNif } from "../../b2b-link";

export class B2BError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function b2bError(error: unknown) {
  const message = error instanceof Error ? error.message : "Não foi possível contactar a loja B2B.";
  return json({ error: message }, error instanceof B2BError ? error.status : 500);
}
function env(name: string, fallback?: string) {
  const value = process.env[name] || (fallback ? process.env[fallback] : "");
  if (!value) throw new B2BError(503, `Ligação à loja B2B ainda não configurada (${name}).`);
  return value;
}
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Utilizador do CRM com sessão e perfil ativo; `db` respeita as permissões dele. */
export async function crmSession(request: Request) {
  const jwt = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!jwt) throw new B2BError(401, "Inicie sessão no CRM.");
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, ...noSession,
  });
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) throw new B2BError(401, "A sessão expirou. Inicie sessão novamente.");
  const profile = await db.from("profiles").select("id,active").eq("id", user.id).single();
  if (profile.error || !profile.data?.active) throw new B2BError(403, "É necessário um perfil ativo no CRM.");
  return { db, userId: user.id };
}
export async function requirePermission(db: SupabaseClient, permission: string) {
  const { data, error } = await db.rpc("has_crm_permission", { permission_name: permission });
  if (error || data !== true) throw new B2BError(403, "O seu perfil não permite esta ação. Contacte a Administração.");
}
export const shopAdmin = () => createClient(env("B2B_SUPABASE_URL"), env("B2B_SERVICE_ROLE_KEY"), noSession);
export const crmAdmin = () => createClient(env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), noSession);

export type CrmClient = { id: string; trade_name: string; tax_id: string | null; email: string | null; phone: string | null; address: string | null; postal_code: string | null; city: string | null };
export type ShopClient = { id: string; name: string; nif: string | null; crm_client_id: string | null };

/** Cliente da loja ligado a este cliente do CRM. Se ainda não houver ligação, liga pelo NIF. */
export async function linkedShopClient(shop: SupabaseClient, client: CrmClient): Promise<ShopClient | null> {
  const linked = await shop.from("b2b_clients").select("id,name,nif,crm_client_id").eq("crm_client_id", client.id).maybeSingle();
  if (linked.error) throw new B2BError(502, linked.error.message);
  if (linked.data) return linked.data as ShopClient;
  const nif = normalizeNif(client.tax_id);
  if (!nif) return null;
  const candidates = await shop.from("b2b_clients").select("id,name,nif,crm_client_id").is("crm_client_id", null).not("nif", "is", null);
  if (candidates.error) throw new B2BError(502, candidates.error.message);
  const match = (candidates.data as ShopClient[]).find(row => normalizeNif(row.nif) === nif);
  if (!match) return null;
  const updated = await shop.from("b2b_clients").update({ crm_client_id: client.id }).eq("id", match.id).is("crm_client_id", null);
  if (updated.error) throw new B2BError(502, updated.error.message);
  return { ...match, crm_client_id: client.id };
}
