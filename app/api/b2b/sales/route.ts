// Dashboard comercial: vendas da loja B2B (por marca, cliente e mês) para o período pedido.
// Administração vê tudo (ou um comercial à escolha); um comercial vê só os clientes que lhe estão atribuídos.
import { B2BError, b2bError, crmSession, json, shopAdmin } from "../server";
export const dynamic = "force-dynamic";

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request: Request) {
  try {
    const { db, userId } = await crmSession(request);
    const params = new URL(request.url).searchParams;
    const from = params.get("from"), to = params.get("to"), prevFrom = params.get("prev_from"), prevTo = params.get("prev_to");
    if (!isDate(from) || !isDate(to) || !isDate(prevFrom) || !isDate(prevTo)) throw new B2BError(400, "Período inválido.");
    const { data: admin } = await db.rpc("commercial_is_admin");
    const requested = params.get("owner");
    const owner = admin === true ? (requested && requested !== "all" ? requested : null) : userId;
    let crmClients: string[] | null = null;
    if (owner) {
      const { data, error } = await db.from("clients").select("id").eq("owner_id", owner).limit(5000);
      if (error) throw new B2BError(502, "Não foi possível ler os clientes.");
      crmClients = (data ?? []).map((x: { id: string }) => x.id);
    }
    const { data, error } = await shopAdmin().rpc("b2b_sales_stats", { p_from: from, p_to: to, p_prev_from: prevFrom, p_prev_to: prevTo, p_crm_clients: crmClients });
    if (error) throw new B2BError(502, "Não foi possível ler as vendas da loja.");
    return json(data);
  } catch (error) {
    return b2bError(error);
  }
}
