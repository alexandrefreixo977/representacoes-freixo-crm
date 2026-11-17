// Dashboard: visitas ao site institucional e à loja B2B, e marcas mais vistas (só administradores).
import { B2BError, b2bError, crmSession, json, shopAdmin } from "../server";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await crmSession(request);
    const { data: admin } = await db.rpc("commercial_is_admin");
    if (admin !== true) throw new B2BError(403, "Reservado à administração.");
    const days = Math.min(366, Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 30));
    const { data, error } = await shopAdmin().rpc("b2b_visit_stats", { p_days: days });
    if (error) throw new B2BError(502, "Não foi possível ler as visitas.");
    return json(data);
  } catch (error) {
    return b2bError(error);
  }
}
