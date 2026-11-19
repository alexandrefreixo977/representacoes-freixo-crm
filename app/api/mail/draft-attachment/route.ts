import { applicationToken, json, MailError, mailError, mailSession, requireMailPermission } from "../server";
import { validGraphId } from "../../../mail-content";
import { draftAttachments, graphWrite, requireDraft } from "../graph-write";
import { boundedJson } from "../body";
export const dynamic = "force-dynamic";

const DIRECT = 3 * 1024 * 1024;
const MAX_FILE = 20 * 1024 * 1024;
const CHUNK = 10 * 320 * 1024;

export async function POST(request: Request) {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    const body = await boundedJson(request, Math.ceil(MAX_FILE * 4 / 3) + 4096, "O anexo ultrapassa 20 MB.");
    if (!validGraphId(body?.draftId)) throw new MailError(400, "Rascunho inválido.");
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 255 || /[\r\n\0]/.test(body.name)) throw new MailError(400, "Nome de anexo inválido.");
    if (typeof body.contentBytes !== "string" || body.contentBytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.contentBytes)) throw new MailError(400, "Anexo inválido.");
    const contentType = typeof body.contentType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(body.contentType) ? body.contentType : "application/octet-stream";
    const size = body.contentBytes.length * 3 / 4 - (body.contentBytes.endsWith("==") ? 2 : body.contentBytes.endsWith("=") ? 1 : 0);
    if (size > MAX_FILE) throw new MailError(413, "O anexo ultrapassa 20 MB.");
    const token = await applicationToken();
    await requireDraft(token, user.email, body.draftId);
    const path = `/messages/${encodeURIComponent(body.draftId)}/attachments`;
    if (size < DIRECT) {
      await graphWrite(token, user.email, path, "POST", { "@odata.type": "#microsoft.graph.fileAttachment", name: body.name, contentType, contentBytes: body.contentBytes }, "Não foi possível anexar o ficheiro.");
    } else {
      const session = await graphWrite(token, user.email, path + "/createUploadSession", "POST", { AttachmentItem: { attachmentType: "file", name: body.name, size, contentType } }, "Não foi possível preparar o envio do anexo.");
      if (typeof session?.uploadUrl !== "string" || !session.uploadUrl.startsWith("https://")) throw new MailError(502, "A Microsoft não aceitou o anexo.");
      const binary = atob(body.contentBytes);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      for (let start = 0; start < bytes.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, bytes.length);
        const response = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` }, body: bytes.slice(start, end) });
        if (!response.ok) throw new MailError(502, "O envio do anexo foi interrompido. Tente novamente.");
      }
    }
    return json({ attachments: await draftAttachments(token, user.email, body.draftId) });
  } catch (error) { return mailError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    const params = new URL(request.url).searchParams;
    const draftId = params.get("draftId"), attachmentId = params.get("attachmentId");
    if (!validGraphId(draftId) || !validGraphId(attachmentId)) throw new MailError(400, "Anexo inválido.");
    const token = await applicationToken();
    await requireDraft(token, user.email, draftId);
    await graphWrite(token, user.email, `/messages/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(attachmentId)}`, "DELETE");
    return json({ attachments: await draftAttachments(token, user.email, draftId) });
  } catch (error) { return mailError(error); }
}
