// A gestão convida um utilizador para um cliente: o Supabase envia um email com a ligação para definir a palavra-passe.
// Só pode ser chamada por um utilizador com role 'admin' em b2b_users.
// Segredos: APP_URL
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const env = (k: string) => Deno.env.get(k) ?? "";
// Chaves: as que o GitHub Actions configura (B2B_SERVICE_KEY) ou as que o Supabase injeta por omissão.
const serviceKey = () => env("B2B_SERVICE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = (req: Request) => env("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const userClient = createClient(env("SUPABASE_URL"), anonKey(req), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await userClient.rpc("b2b_is_admin");
  if (!isAdmin) return json({ message: "Sem permissão." }, 403);

  const { clientId, email } = await req.json();
  const admin = createClient(env("SUPABASE_URL"), serviceKey());
  const { data, error } = await admin.auth.admin.inviteUserByEmail(String(email).trim().toLowerCase(), { redirectTo: env("APP_URL") });
  if (error || !data.user) return json({ message: error?.message ?? "Erro ao convidar." }, 400);
  const { error: e2 } = await admin.from("b2b_users").upsert({ user_id: data.user.id, client_id: clientId, role: "client" });
  if (e2) return json({ message: e2.message }, 400);
  return json({ message: `Convite enviado para ${email}.` });
});
