// Propostas da loja B2B → oportunidades do CRM. Idempotente: cada proposta dá no máximo uma oportunidade.
import { followUpDate, normalizeNif, stageForQuote } from "../../../b2b-link";
import { b2bError, crmAdmin, crmSession, json, shopAdmin } from "../server";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await crmSession(request);
    const shop = shopAdmin();
    const crm = crmAdmin();
    const [quotes, shopClients] = await Promise.all([
      shop.from("b2b_quotes").select("id,number,status,total,created_at,owner_email,client_id,customer_nif,customer_name").in("status", ["sent", "accepted", "lost"]).order("created_at").limit(1000),
      shop.from("b2b_clients").select("id,nif,crm_client_id"),
    ]);
    if (quotes.error) throw new Error(quotes.error.message);
    if (shopClients.error) throw new Error(shopClients.error.message);
    if (!quotes.data.length) return json({ created: 0, updated: 0 });
    const [clients, stages, profiles, existing] = await Promise.all([
      crm.from("clients").select("id,tax_id,owner_id"),
      crm.from("opportunity_stages").select("id,name,probability"),
      crm.from("profiles").select("id,email,active").eq("active", true),
      crm.from("opportunities").select("id,b2b_quote_id,stage_id,outcome,estimated_value").in("b2b_quote_id", quotes.data.map(q => q.id)),
    ]);
    for (const r of [clients, stages, profiles, existing]) if (r.error) throw new Error(r.error.message);
    const crmByNif = new Map((clients.data ?? []).filter(c => normalizeNif(c.tax_id)).map(c => [normalizeNif(c.tax_id), c]));
    const ownerOf = new Map((clients.data ?? []).map(c => [c.id, c.owner_id]));
    const shopLink = new Map((shopClients.data ?? []).map(c => [c.id, c]));
    const stageByName = new Map((stages.data ?? []).map(s => [s.name, s]));
    const activeProfiles = new Map((profiles.data ?? []).map(p => [String(p.email ?? "").toLowerCase(), p.id]));
    const activeIds = new Set((profiles.data ?? []).map(p => p.id));
    const byQuote = new Map((existing.data ?? []).map(o => [o.b2b_quote_id, o]));
    let created = 0, updated = 0;
    for (const quote of quotes.data) {
      const stage = stageByName.get(stageForQuote(quote.status) ?? "");
      if (!stage) continue;
      const link = quote.client_id ? shopLink.get(quote.client_id) : undefined;
      const clientId = link?.crm_client_id ?? crmByNif.get(normalizeNif(quote.customer_nif || link?.nif))?.id;
      if (!clientId) continue;
      const current = byQuote.get(quote.id);
      const total = Number(quote.total) || 0;
      const closing = quote.status === "accepted" ? { final_value: total } : quote.status === "lost" ? { loss_reason: "Recusada na loja B2B" } : {};
      if (current) {
        // Só fecha automaticamente; uma oportunidade em curso não volta atrás por causa da loja.
        const close = quote.status !== "sent" && current.outcome === "active" && current.stage_id !== stage.id;
        if (!close && Number(current.estimated_value) === total) continue;
        const r = await crm.from("opportunities").update({ estimated_value: total, ...(close ? { stage_id: stage.id, probability: stage.probability, ...closing } : {}) }).eq("id", current.id);
        if (r.error) throw new Error(r.error.message);
        updated++;
        continue;
      }
      const owner = ownerOf.get(clientId);
      const seller = activeProfiles.get(String(quote.owner_email ?? "").toLowerCase()) ?? (owner && activeIds.has(owner) ? owner : userId);
      const r = await crm.from("opportunities").insert({
        client_id: clientId, seller_id: seller, stage_id: stage.id, probability: stage.probability,
        title: `Proposta ${quote.number} (loja B2B)`, estimated_value: total, source: "Loja B2B", reference: quote.number, b2b_quote_id: quote.id,
        next_action: quote.status === "sent" ? "Acompanhar proposta da loja" : null,
        next_action_date: quote.status === "sent" ? followUpDate(quote.created_at) : null,
        ...closing,
      });
      if (r.error && r.error.code !== "23505") throw new Error(r.error.message);
      if (!r.error) created++;
    }
    return json({ created, updated });
  } catch (error) { return b2bError(error); }
}
