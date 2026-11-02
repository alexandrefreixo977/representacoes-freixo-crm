import { applicationToken, json, MailError, mailError, mailSession, readGraph } from "../server";
import { validGraphId } from "../../../mail-content";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user } = await mailSession(request);
    const params = new URL(request.url).searchParams;
    const messageId = params.get("messageId"), attachmentId = params.get("attachmentId");
    if (!validGraphId(messageId) || !validGraphId(attachmentId)) throw new MailError(400, "Indique a mensagem e o anexo.");
    const token = await applicationToken();
    const file = await readGraph(token, user.email, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    if (typeof file.contentBytes !== "string") throw new MailError(422, "Este tipo de anexo deve ser aberto no Outlook.");
    return json({ name: file.name, contentType: file.contentType || "application/octet-stream", contentBytes: file.contentBytes });
  } catch (error) { return mailError(error); }
}
