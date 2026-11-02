import { applicationToken, json, MailError, mailError, mailSession, readGraph } from "../server";
import { inlineImages, validGraphId, type FullMail, type MailAttachment } from "../../../mail-content";
import { readGraphUrl } from "../server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user } = await mailSession(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!validGraphId(id)) throw new MailError(400, "Indique a mensagem a abrir.");
    const token = await applicationToken();
    const path = `/messages/${encodeURIComponent(id)}`;
    const message = await readGraph(token, user.email, `${path}?$select=id,conversationId,subject,body,from,replyTo,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments`) as FullMail;
    const attachments: MailAttachment[] = [];
    // hasAttachments excludes inline-only images in Microsoft Graph.
    if (message.hasAttachments || /cid:/i.test(message.body?.content || "")) {
      let page = await readGraph(token, user.email, `${path}/attachments?$select=id,name,contentType,size,isInline`);
      for (;;) {
        for (const attachment of page.value as MailAttachment[]) {
          const file = attachment.isInline ? await readGraph(token, user.email, `${path}/attachments/${encodeURIComponent(attachment.id)}`) : attachment;
          attachments.push(file);
        }
        if (!page["@odata.nextLink"]) break;
        page = await readGraphUrl(token, page["@odata.nextLink"]);
      }
    }
    if (message.body?.contentType.toLowerCase() === "html") message.body.content = inlineImages(message.body.content, attachments);
    return json({ ...message, attachments: attachments.map(({ contentBytes: _bytes, ...metadata }) => metadata) });
  } catch (error) { return mailError(error); }
}
