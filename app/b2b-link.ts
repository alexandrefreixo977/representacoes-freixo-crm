// Regras da ligação entre o CRM e a loja B2B (b2b.representacoesfreixo.com).
export const B2B_SHOP_URL = "https://b2b.representacoesfreixo.com";

/** NIF só com algarismos e letras, sem prefixo PT, para comparar clientes entre as duas bases. */
export function normalizeNif(value: string | null | undefined): string {
  const clean = String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return clean.startsWith("PT") && clean.length > 2 ? clean.slice(2) : clean;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "lost";
/** Fase da oportunidade que corresponde ao estado da proposta da loja. Rascunhos não entram no CRM. */
export function stageForQuote(status: string): "Proposta enviada" | "Ganha" | "Perdida" | null {
  if (status === "sent") return "Proposta enviada";
  if (status === "accepted") return "Ganha";
  if (status === "lost") return "Perdida";
  return null;
}

export const orderStatusLabel: Record<string, string> = {
  pending: "Por validar", validated: "Validada", sent: "Enviada ao fabricante", confirmed: "Confirmada", delivered: "Entregue", cancelled: "Cancelada",
};
export const quoteStatusLabel: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceite", lost: "Perdida" };

/** Data (AAAA-MM-DD) para acompanhar a proposta: 7 dias depois de criada, nunca no passado. */
export function followUpDate(createdAt: string, now = new Date()): string {
  const due = new Date(new Date(createdAt).getTime() + 7 * 86400000);
  return (due < now ? now : due).toISOString().slice(0, 10);
}
