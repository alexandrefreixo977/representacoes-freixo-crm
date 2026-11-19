import { MailError, readGraph, readGraphUrl } from "./server";
import type { MailAttachment } from "../../mail-content";

const GRAPH = "https://graph.microsoft.com/v1.0";
const box = (email: string) => `${GRAPH}/users/${encodeURIComponent(email)}`;

// Well-known Outlook folders accepted by name; anything else must be a Graph id.
export const WELL_KNOWN = ["inbox", "drafts", "sentitems", "deleteditems", "junkemail", "archive", "outbox"] as const;
export const folderRef = (value: unknown) => typeof value === "string" && ((WELL_KNOWN as readonly string[]).includes(value) || (value.length <= 2048 && /^[a-z0-9+/_=-]+$/i.test(value))) ? value : null;

export async function graphWrite(token: string, email: string, path: string, method: string, payload?: unknown, failure = "Não foi possível concluir a alteração no Outlook.") {
  let response: Response;
  try {
    response = await fetch(box(email) + path, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"' },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
  } catch { throw new MailError(502, failure); }
  if (!response.ok) {
    if (response.status === 403) throw new MailError(403, "A Microsoft recusou a alteração. Confirme as permissões Mail.ReadWrite e Mail.Send desta caixa.");
    if (response.status === 404) throw new MailError(404, "A mensagem ou pasta já não existe no Outlook. Atualize o correio.");
    throw new MailError(response.status === 429 ? 429 : 502, failure, response.headers.get("Retry-After") ?? undefined);
  }
  if (response.status === 202 || response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

type BatchRequest = { id: string; method: string; url: string; body?: unknown };
// JSON batching: up to 20 requests per call. Returns the status of each request by id.
export async function graphBatch(token: string, email: string, requests: BatchRequest[]) {
  const results = new Map<string, { status: number; body: unknown }>();
  for (let start = 0; start < requests.length; start += 20) {
    const chunk = requests.slice(start, start + 20).map(item => ({
      id: item.id, method: item.method, url: `/users/${encodeURIComponent(email)}${item.url}`,
      headers: { "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' },
      ...(item.body !== undefined ? { body: item.body } : {}),
    }));
    let response: Response;
    try {
      response = await fetch(`${GRAPH}/$batch`, { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: chunk }) });
    } catch { throw new MailError(502, "Não foi possível contactar o Outlook. Tente novamente."); }
    if (!response.ok) throw new MailError(response.status === 429 ? 429 : response.status === 403 ? 403 : 502, response.status === 403 ? "A Microsoft recusou a alteração. Confirme a permissão Mail.ReadWrite desta caixa." : "Não foi possível concluir a alteração no Outlook.", response.headers.get("Retry-After") ?? undefined);
    const data = await response.json() as { responses?: { id: string; status: number; body?: unknown }[] };
    for (const item of data.responses ?? []) results.set(item.id, { status: item.status, body: item.body });
  }
  return results;
}

export const LIST_FIELDS = "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,lastModifiedDateTime,isRead,isDraft,flag,categories,hasAttachments,importance,parentFolderId";

export async function draftAttachments(token: string, email: string, id: string) {
  const list: MailAttachment[] = [];
  let page = await readGraph(token, email, `/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`);
  for (let guard = 0; guard < 5; guard++) {
    list.push(...(page.value as MailAttachment[]));
    if (!page["@odata.nextLink"]) break;
    page = await readGraphUrl(token, page["@odata.nextLink"]);
  }
  return list.filter(file => !file.isInline);
}

export async function requireDraft(token: string, email: string, id: string) {
  const message = await readGraph(token, email, `/messages/${encodeURIComponent(id)}?$select=id,isDraft`);
  if (!message.isDraft) throw new MailError(409, "Esta mensagem já foi enviada e não pode ser editada.");
}

