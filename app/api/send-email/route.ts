const GRAPH = "https://graph.microsoft.com/v1.0";
const DIRECT_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const CHUNK_SIZE = 10 * 320 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;

type Attachment = { name: string; contentType: string; size: number; contentBytes: string };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function env(name: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`Configuração em falta no servidor: ${name}`);
  return value;
}

async function authenticatedSender(jwt: string): Promise<string | null> {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { email?: string };
  return user?.email ?? null;
}

async function appToken(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${env("MICROSOFT_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("MICROSOFT_CLIENT_ID"),
      client_secret: env("MICROSOFT_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || "A Microsoft recusou a autorização da aplicação.");
  return data.access_token;
}

async function graph(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const raw = await res.text();
  const detail = raw ? JSON.parse(raw) : null;
  if (!res.ok) throw new Error(detail?.error?.message || "A Microsoft recusou o envio.");
  return detail;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json(401, { error: "Sem sessão. Volte a iniciar sessão." });

    const sender = await authenticatedSender(jwt);
    if (!sender) return json(401, { error: "Sessão inválida. Volte a iniciar sessão." });

    const body = (await request.json()) as {
      to: string; cc?: string[]; bcc?: string[]; subject: string; bodyHtml: string; attachments?: Attachment[];
    };
    const attachments = body.attachments || [];
    const total = attachments.reduce((sum, attachment) => sum + (attachment.size || 0), 0);
    if (total > MAX_TOTAL) return json(400, { error: "Os anexos ultrapassam o limite máximo de 20 MB." });

    const token = await appToken();
    const box = `/users/${encodeURIComponent(sender)}`;
    const message = {
      subject: body.subject,
      body: { contentType: "HTML", content: body.bodyHtml },
      toRecipients: [{ emailAddress: { address: body.to } }],
      ccRecipients: (body.cc || []).map((address) => ({ emailAddress: { address } })),
      bccRecipients: (body.bcc || []).map((address) => ({ emailAddress: { address } })),
    };

    const hasLarge = attachments.some((attachment) => attachment.size >= DIRECT_ATTACHMENT_LIMIT);
    if (!hasLarge) {
      await graph(token, `${box}/sendMail`, {
        method: "POST",
        body: JSON.stringify({
          message: {
            ...message,
            attachments: attachments.map((attachment) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachment.name,
              contentType: attachment.contentType || "application/octet-stream",
              contentBytes: attachment.contentBytes,
            })),
          },
          saveToSentItems: true,
        }),
      });
      return json(200, { ok: true });
    }

    const draft = await graph(token, `${box}/messages`, { method: "POST", body: JSON.stringify(message) });
    for (const file of attachments) {
      if (file.size < DIRECT_ATTACHMENT_LIMIT) {
        await graph(token, `${box}/messages/${draft.id}/attachments`, {
          method: "POST",
          body: JSON.stringify({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: file.name,
            contentType: file.contentType || "application/octet-stream",
            contentBytes: file.contentBytes,
          }),
        });
        continue;
      }

      const session = await graph(token, `${box}/messages/${draft.id}/attachments/createUploadSession`, {
        method: "POST",
        body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: file.name, size: file.size, contentType: file.contentType || "application/octet-stream" } }),
      });
      const bytes = base64ToBytes(file.contentBytes);
      for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, bytes.length);
        const put = await fetch(session.uploadUrl, {
          method: "PUT",
          headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` },
          body: bytes.subarray(start, end),
        });
        if (!put.ok) throw new Error(`Não foi possível carregar o anexo ${file.name}.`);
      }
    }

    await graph(token, `${box}/messages/${draft.id}/send`, { method: "POST" });
    return json(200, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar o email.";
    return json(500, { error: message });
  }
}
