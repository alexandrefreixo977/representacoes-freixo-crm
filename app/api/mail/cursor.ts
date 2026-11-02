import { MailError } from "./server";
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = (text: string) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
async function key() {
  const secret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!secret) throw new MailError(503, "Configuração Microsoft indisponível.");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function nextCursor(url: string | undefined, owner: string, scope: string) {
  if (!url) return null;
  const payload = encode(new TextEncoder().encode(JSON.stringify({ url, owner, scope, expires: Date.now() + 3600000 })));
  const signature = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function cursorUrl(cursor: string, owner: string, scope: string) {
  try {
    if (cursor.length > 16000) throw new Error();
    const parts = cursor.split(".");
    if (parts.length !== 2 || !await crypto.subtle.verify("HMAC", await key(), decode(parts[1]), new TextEncoder().encode(parts[0]))) throw new Error();
    const data = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (data.owner !== owner || data.scope !== scope || !Number.isFinite(data.expires) || data.expires < Date.now() || typeof data.url !== "string") throw new Error();
    return data.url as string;
  } catch { throw new MailError(400, "A página expirou ou é inválida. Use Atualizar."); }
}
