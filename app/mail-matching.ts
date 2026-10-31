export type MailParty = { emailAddress?: { address?: string; name?: string } };
export type GraphMessage = {
  id: string; conversationId?: string; from?: MailParty; toRecipients?: MailParty[];
  subject?: string; bodyPreview?: string; sentDateTime?: string; receivedDateTime?: string; isRead?: boolean;
};
export type MailCandidate = { email: string | null; client_id?: string; contact_id?: string; manufacturer_id?: string; name?: string };
const normalize = (email?: string | null) => (email ?? "").trim().toLowerCase();

export function buildMailIndex(candidates: MailCandidate[]) {
  const index = new Map<string, MailCandidate[]>();
  for (const candidate of candidates) {
    const address = normalize(candidate.email);
    if (address) index.set(address, [...(index.get(address) ?? []), candidate]);
  }
  return index;
}

export type LiveMessage = GraphMessage & {
  direction: "in" | "out";
  entidade: { tipo: "cliente" | "fabricante" | null; id: string | null; nome: string | null };
  lead: boolean;
};

export function liveMail(message: GraphMessage, direction: "in" | "out", index: Map<string, MailCandidate[]>): LiveMessage {
  const address = normalize((direction === "in" ? message.from : message.toRecipients?.[0])?.emailAddress?.address);
  const matches = index.get(address) ?? [];
  const entities = new Map<string, LiveMessage["entidade"]>();
  for (const match of matches) {
    if (match.client_id) entities.set(`c:${match.client_id}`, { tipo: "cliente", id: match.client_id, nome: match.name || "Cliente" });
    if (match.manufacturer_id) entities.set(`m:${match.manufacturer_id}`, { tipo: "fabricante", id: match.manufacturer_id, nome: match.name || "Fabricante" });
  }
  // Shared addresses are known but must not be assigned to an arbitrary dossier.
  const entidade = entities.size === 1 ? [...entities.values()][0] : { tipo: null, id: null, nome: null };
  return { ...message, direction, entidade, lead: direction === "in" && matches.length === 0 };
}

