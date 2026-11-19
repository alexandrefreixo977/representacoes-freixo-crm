import { MailError } from "./server";
// Reads a JSON request without trusting Content-Length, stopping at the limit.
export async function boundedJson(request: Request, limit: number, tooLarge: string) {
  const reader = request.body?.getReader();
  if (!reader) throw new MailError(400, "Pedido vazio.");
  let total = 0, text = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new MailError(413, tooLarge); }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new MailError(400, "Formato do pedido inválido."); }
}
