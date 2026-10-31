export const escapeMailText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
export const signedMailBody = (text: string, signature: string) => escapeMailText(text) + (signature ? `<br><br>${signature}` : "");
export function prependReply(original: { contentType: string; content: string }, html: string) {
  if (original.contentType?.toLowerCase() !== "html") return `${html}<br><br>${escapeMailText(original.content || "")}`;
  if (/<body\b[^>]*>/i.test(original.content)) return original.content.replace(/<body\b[^>]*>/i, opening => `${opening}${html}<br><br>`);
  return `${html}<br><br>${original.content}`;
}
