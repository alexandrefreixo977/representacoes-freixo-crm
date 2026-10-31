import type { GraphMessage, MailParty } from "./mail-matching";

export type MailAttachment = { id: string; name: string; contentType: string; size: number; isInline: boolean; contentId?: string; contentBytes?: string; "@odata.type"?: string };
export type FullMail = GraphMessage & { body: { contentType: string; content: string }; ccRecipients?: MailParty[]; replyTo?: MailParty[]; hasAttachments?: boolean; attachments: MailAttachment[] };
export type ReplyMode = "reply" | "replyAll" | "forward";
// Single-action Graph JSON requests must stay below 4 MB after base64 encoding.
export const MAX_REPLY_ATTACHMENTS = 2.5 * 1024 * 1024;
export const MAX_REPLY_COMMENT = 50000;
export const validGraphId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 2048 && /^[a-z0-9+/_=-]+$/i.test(value);
export function inlineImages(html: string, attachments: MailAttachment[]) {
  const images = new Map<string, string>();
  for (const file of attachments) {
    if (file.isInline && file.contentId && file.contentBytes && /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.contentType) && /^[a-z0-9+/]*={0,2}$/i.test(file.contentBytes)) images.set(file.contentId.replace(/^<|>$/g, "").toLowerCase(), `data:${file.contentType};base64,${file.contentBytes}`);
  }
  return html.replace(/\bsrc\s*=\s*(?:"cid:([^"]+)"|'cid:([^']+)'|cid:([^\s>]+))/gi, (original, a, b, c) => {
    let id = a || b || c;
    try { id = decodeURIComponent(id); } catch { /* Some senders use literal percent signs. */ }
    const uri = images.get(id.replace(/^<|>$/g, "").toLowerCase());
    return uri ? `src="${uri}"` : original;
  });
}
export function replyRecipients(message: FullMail, mode: ReplyMode, ownEmail: string | string[]) {
  const addresses = (parties?: MailParty[]) => (parties ?? []).map(party => party.emailAddress?.address?.trim().toLowerCase()).filter((address): address is string => Boolean(address));
  const own = new Set((Array.isArray(ownEmail) ? ownEmail : [ownEmail]).map(address => address.toLowerCase()));
  const sender = addresses(message.replyTo?.length ? message.replyTo : message.from ? [message.from] : []);
  if (mode === "forward") return { to: [], cc: [], bcc: [] };
  const to = [...new Set([...sender, ...(mode === "replyAll" ? addresses(message.toRecipients) : [])])].filter(address => !own.has(address));
  const cc = mode === "replyAll" ? [...new Set(addresses(message.ccRecipients))].filter(address => !own.has(address) && !to.includes(address)) : [];
  return { to, cc, bcc: [] };
}
