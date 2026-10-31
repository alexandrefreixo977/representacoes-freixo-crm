import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildMailIndex, type MailCandidate } from "../../mail-matching";

export class MailError extends Error {
  status: number;
  retryAfter?: string;
  constructor(status: number, message: string, retryAfter?: string) {
    super(message); this.status = status; this.retryAfter = retryAfter;
  }
}
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function mailError(error: unknown) {
  return json({ error: error instanceof Error ? error.message : "Não foi possível aceder ao correio.", ...(error instanceof MailError && error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, error instanceof MailError ? error.status : 500);
}
function env(name: string, fallback?: string) {
  const value = process.env[name] || (fallback ? process.env[fallback] : "");
  if (!value) throw new MailError(503, `Configuração em falta no servidor: ${name}`);
  return value;
}
export async function mailSession(request: Request) {
  const jwt = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!jwt) throw new MailError(401, "Inicie sessão para consultar o correio.");
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user?.email) throw new MailError(401, "A sessão expirou. Inicie sessão novamente.");
  const profile = await db.from("profiles").select("id,active").eq("id", user.id).single();
  if (profile.error || !profile.data?.active) throw new MailError(403, "É necessário um perfil ativo no CRM.");
  return { db, user: { id: user.id, email: user.email } };
}
export async function requireMailPermission(db:SupabaseClient){
  const {data,error}=await db.rpc('has_crm_permission',{permission_name:'emails.own'});
  if(error||data!==true)throw new MailError(403,'O seu perfil não permite enviar ou alterar emails. Contacte a Administração.');
}
export async function applicationToken() {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env("MICROSOFT_TENANT_ID"))}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("MICROSOFT_CLIENT_ID"), client_secret: env("MICROSOFT_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const data = await response.json() as { access_token?: string };
  if (!response.ok || !data.access_token) throw new MailError(502, "Não foi possível autorizar o acesso Microsoft.");
  return data.access_token;
}
export async function readGraph(token: string, email: string, path: string) {
  return readGraphUrl(token, `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}${path}`);
}
export async function readGraphUrl(token: string, address: string) {
  const url = new URL(address);
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/users/")) throw new MailError(400, "Página de correio inválida.");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId"' },
  });
  if (!response.ok) {
    if (response.status === 403) throw new MailError(403, "A Microsoft recusou a leitura desta caixa. Confirme a permissão de aplicação Mail.Read, o consentimento do administrador e o acesso à caixa.");
    if (response.status === 404) throw new MailError(404, "A caixa ou mensagem já não está disponível na Microsoft.");
    throw new MailError(response.status === 429 ? 429 : 502, "Não foi possível ler o correio Microsoft. Tente novamente.", response.headers.get("Retry-After") ?? undefined);
  }
  return response.json();
}
export async function knownMail(db: SupabaseClient) {
  const candidates: MailCandidate[] = [];
  const clientIds = new Set<string>();
  const manufacturerIds = new Set<string>();
  const names = new Map<string, string>();
  const specs = [
    { table: "clients", select: "id,trade_name,email", email: "email", parent: "client_id" },
    { table: "client_contacts", select: "id,email,client_id", email: "email", parent: "client_id" },
    { table: "manufacturers", select: "id,name,general_email", email: "general_email", parent: "manufacturer_id" },
    { table: "manufacturer_contacts", select: "id,email,manufacturer_id", email: "email", parent: "manufacturer_id" },
  ];
  for (const spec of specs) {
    for (let offset = 0; ; offset += 500) {
      let query = db.from(spec.table).select(spec.select).order("id").range(offset, offset + 499);
      if (spec.table === "clients") query = query.is("archived_at", null);
      if (spec.table === "client_contacts") query = query.eq("active", true);
      if (spec.table.startsWith("manufacturer")) query = query.is("deleted_at", null).eq("active", true);
      const result = await query;
      if (result.error) throw new MailError(500, "Não foi possível consultar os endereços do CRM.");
      const rows = result.data as unknown as Record<string, string | null>[];
      for (const row of rows) {
        if (row.id && (row.trade_name || row.name)) names.set(row.id, row.trade_name || row.name!);
        if (spec.table === "clients" && row.id) clientIds.add(row.id);
        if (spec.table === "manufacturers" && row.id) manufacturerIds.add(row.id);
        if (spec.table === "client_contacts" && !clientIds.has(row.client_id ?? "")) continue;
        if (spec.table === "manufacturer_contacts" && !manufacturerIds.has(row.manufacturer_id ?? "")) continue;
        candidates.push({ email: row[spec.email], name: names.get((row[spec.parent] ?? row.id)!), [spec.parent]: row[spec.parent] ?? row.id, ...(spec.table === "client_contacts" ? { contact_id: row.id! } : {}) });
      }
      if (rows.length < 500) break;
    }
  }
  return buildMailIndex(candidates);
}
