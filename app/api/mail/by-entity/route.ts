import { liveMail, type GraphMessage } from "../../../mail-matching";
import { applicationToken, json, knownMail, MailError, mailError, mailSession, readGraph, readGraphUrl } from "../server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const addresses = [...new Set(new URL(request.url).searchParams.getAll("email").map(value => value.trim().toLowerCase()))];
    if (!addresses.length || addresses.length > 30 || addresses.some(address => address.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(address))) throw new MailError(400, "Indique entre 1 e 30 endereços de email válidos.");
    const [token, index] = await Promise.all([applicationToken(), knownMail(db)]);
    const messages = new Map<string, GraphMessage>();
    let limited = false;
    // Graph limits message search to 1,000 results per address. Follow every
    // returned page and report the limit instead of silently truncating history.
    for (let offset = 0; offset < addresses.length; offset += 3) {
      await Promise.all(addresses.slice(offset, offset + 3).map(async address => {
        const query = new URLSearchParams({ "$search": `"participants:${address}"`, "$select": "id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,isRead", "$top": "100" });
        let result = await readGraph(token, user.email, `/messages?${query}`);
        let count = 0;
        for (;;) {
          for (const message of result.value as GraphMessage[]) messages.set(message.id, message);
          count += result.value.length;
          if (count >= 1000) { limited = true; break; }
          if (!result["@odata.nextLink"]) break;
          result = await readGraphUrl(token, result["@odata.nextLink"]);
        }
      }));
    }
    const mensagens = [...messages.values()].sort((a, b) => (b.receivedDateTime || b.sentDateTime || "").localeCompare(a.receivedDateTime || a.sentDateTime || "")).map(message => liveMail(message, message.from?.emailAddress?.address?.toLowerCase() === user.email.toLowerCase() ? "out" : "in", index));
    return json({ mensagens, nextPage: null, limited });
  } catch (error) { return mailError(error); }
}
