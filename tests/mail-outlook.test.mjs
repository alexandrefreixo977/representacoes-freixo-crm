import assert from "node:assert/strict";
import test from "node:test";
import { moduleUrl } from "./mail-module.mjs";
const html = await import(await moduleUrl(new URL("../app/mail-html.ts", import.meta.url)));
const { GET: folders } = await import(await moduleUrl(new URL("../app/api/mail/folders/route.ts", import.meta.url)));
const { GET: messages } = await import(await moduleUrl(new URL("../app/api/mail/messages/route.ts", import.meta.url)));
const { POST: actions } = await import(await moduleUrl(new URL("../app/api/mail/actions/route.ts", import.meta.url)));
const draft = await import(await moduleUrl(new URL("../app/api/mail/draft/route.ts", import.meta.url)));
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://crm.example.com", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", MICROSOFT_TENANT_ID: "tenant", MICROSOFT_CLIENT_ID: "client", MICROSOFT_CLIENT_SECRET: "secret" });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const request = (path, body, method) => new Request("https://crm.local/api/mail/" + path, { method: method ?? (body ? "POST" : "GET"), headers: { authorization: "Bearer jwt", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

function mock(t, graph = () => null, { permission = true } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input)); let body; try { body = typeof init.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; } calls.push({ url, init, body });
    if (url.pathname === "/auth/v1/user") return reply({ id: "owner", email: "owner@example.com" });
    if (url.pathname === "/rest/v1/profiles") return reply({ id: "owner", active: true });
    if (url.pathname === "/rest/v1/rpc/has_crm_permission") return reply(permission);
    if (url.pathname.startsWith("/rest/v1/")) return reply([]);
    if (url.hostname === "login.microsoftonline.com") return reply({ access_token: "token" });
    if (url.hostname === "graph.microsoft.com") { const result = graph(url, init); if (result) return result; return reply({ value: [] }); }
    throw new Error("Unexpected " + url);
  });
  return calls;
}

test("sanitizer keeps formatting and drops scripts, handlers and unsafe links", () => {
  const clean = html.sanitizeComposeHtml(`<p style="color:red;position:fixed">Olá <b onclick="x()">mundo</b></p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://rf.pt">rf</a><img src="http://x/y.png" onerror="z"><iframe src="https://x"></iframe><font color="#c00">c</font>`);
  assert.match(clean, /<p style="color: red">Olá <b>mundo<\/b><\/p>/);
  assert.doesNotMatch(clean, /script|onclick|onerror|iframe|javascript|position/i);
  assert.match(clean, /<a href="https:\/\/rf.pt" target="_blank" rel="noopener noreferrer">rf<\/a>/);
  assert.match(clean, /<img>/);
  assert.match(clean, /<font color="#c00">c<\/font>/);
  assert.equal(html.sanitizeComposeHtml("a < b"), "a &lt; b");
});

test("draft body keeps the quoted original separate from the editable part", () => {
  const quote = '<html><head></head><body><hr><div id="divRplyFwdMsg">De: X</div><p>Original</p></body></html>';
  const combined = html.combineDraftBody("<p>Resposta</p>", quote);
  assert.deepEqual(html.splitDraftBody(combined), { own: "<p>Resposta</p>", quote });
  const outlook = html.splitDraftBody('<html><body><p>Escrito no Outlook</p><div id="appendonsend"></div><hr><div id="divRplyFwdMsg">De</div></body></html>');
  assert.equal(outlook.own, "<p>Escrito no Outlook</p>");
  assert.match(outlook.quote, /^<html><body><div id="appendonsend">/);
  assert.deepEqual(html.splitDraftBody(html.combineDraftBody("<p>Novo</p>", "")), { own: "<p>Novo</p>", quote: "" });
});

test("folders: well-known folders first with Portuguese names, hidden system folders removed", async t => {
  mock(t, url => {
    const name = url.pathname.split("/mailFolders/")[1];
    if (url.pathname.endsWith("/mailFolders")) return reply({ value: [{ id: "Z", displayName: "20 CLIENTES", childFolderCount: 2 }, { id: "S", displayName: "Sent Items" }, { id: "I", displayName: "Inbox", unreadItemCount: 4 }, { id: "H", displayName: "Conversation History" }] });
    if (name === "inbox") return reply({ id: "I" });
    if (name === "sentitems") return reply({ id: "S" });
    return reply({}, 404);
  });
  const data = await (await folders(request("folders"))).json();
  assert.deepEqual(data.folders.map(folder => folder.displayName), ["Caixa de Entrada", "Itens Enviados", "20 CLIENTES"]);
  assert.equal(data.folders[0].wellKnown, "inbox");
});

test("messages: any folder id, filters lead the orderby property, search never sends orderby", async t => {
  const calls = mock(t, () => reply({ value: [{ id: "1", from: { emailAddress: { address: "owner@example.com" } }, isRead: false, flag: { flagStatus: "flagged" } }] }));
  assert.equal((await messages(request("messages?folder=AAMkFolder%3D&filter=unread"))).status, 200);
  let graph = calls.filter(call => call.url.hostname === "graph.microsoft.com").at(-1).url;
  assert.match(graph.pathname, /mailFolders\/AAMkFolder%3D\/messages$/);
  assert.equal(graph.searchParams.get("$filter"), "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false");
  assert.equal(graph.searchParams.get("$orderby"), "receivedDateTime desc");
  const all = await (await messages(request("messages?folder=inbox&q=luvas&scope=all&filter=flagged"))).json();
  graph = calls.filter(call => call.url.hostname === "graph.microsoft.com").at(-1).url;
  assert.equal(graph.pathname, "/v1.0/users/owner%40example.com/messages");
  assert.equal(graph.searchParams.has("$orderby"), false);
  assert.equal(all.mensagens[0].direction, "out");
  assert.equal((await messages(request("messages?folder=..%2Fx"))).status, 400);
  assert.equal((await messages(request("messages?filter=drop"))).status, 400);
});

test("actions: batch PATCH for flags, move resolves folder, purge only from Itens Eliminados", async t => {
  let calls = mock(t, (url, init) => {
    if (url.pathname.endsWith("/$batch")) { const body = JSON.parse(init.body); return reply({ responses: body.requests.map(item => ({ id: item.id, status: 200 })) }); }
    if (url.pathname.endsWith("/mailFolders/deleteditems")) return reply({ id: "DEL" });
    if (url.pathname.endsWith("/mailFolders/junkemail")) return reply({ id: "JUNK" });
    if (url.pathname.includes("/mailFolders/")) return reply({ id: "TARGET" });
    if (url.pathname.includes("/messages/")) return reply({ parentFolderId: "INBOX" });
    return null;
  });
  assert.deepEqual(await (await actions(request("actions", { action: "flag", ids: ["a", "b"] }))).json(), { ok: true, failed: [] });
  const batch = calls.find(call => call.url.pathname.endsWith("/$batch")).body.requests;
  assert.deepEqual(batch.map(item => [item.method, item.url, item.body]), [["PATCH", "/users/owner%40example.com/messages/a", { flag: { flagStatus: "flagged" } }], ["PATCH", "/users/owner%40example.com/messages/b", { flag: { flagStatus: "flagged" } }]]);
  const moved = await (await actions(request("actions", { action: "move", ids: ["a"], destination: "archive" }))).json();
  assert.equal(moved.folderId, "TARGET");
  assert.deepEqual(calls.filter(call => call.url.pathname.endsWith("/$batch")).at(-1).body.requests[0].body, { destinationId: "TARGET" });
  assert.equal((await actions(request("actions", { action: "purge", ids: ["a"] }))).status, 409);
  const deleted = await actions(request("actions", { action: "delete", ids: ["a"] }));
  assert.equal(deleted.status, 200);
  assert.deepEqual(calls.filter(call => call.url.pathname.endsWith("/$batch")).at(-1).body.requests[0].body, { destinationId: "DEL" });
  assert.equal((await actions(request("actions", { action: "move", ids: ["a"], destination: "../x" }))).status, 400);
  assert.equal((await actions(request("actions", { action: "drop", ids: ["a"] }))).status, 400);
  t.mock.restoreAll();
  calls = mock(t, () => null, { permission: false });
  assert.equal((await actions(request("actions", { action: "read", ids: ["a"] }))).status, 403);
  assert.equal(calls.some(call => call.url.hostname === "graph.microsoft.com"), false);
});

test("draft: reply lets Outlook set recipients, keeps the quote, and Send validates recipients", async t => {
  const calls = mock(t, (url, init) => {
    if (url.pathname.endsWith("/createReply")) return reply({ id: "D1", subject: "RE: Olá", toRecipients: [{ emailAddress: { address: "Cliente@Example.com" } }], body: { contentType: "html", content: "<html><body><hr><div id=\"divRplyFwdMsg\">Original</div></body></html>" } });
    if (init.method === "PATCH") return reply({ id: "D1" });
    if (url.pathname.endsWith("/send")) return new Response(null, { status: 202 });
    if (url.pathname.endsWith("/messages/D1")) return reply({ id: "D1", isDraft: true });
    return null;
  });
  const opened = await (await draft.POST(request("draft", { mode: "reply", sourceId: "M1", html: "<p>Olá<script>x</script></p>" }))).json();
  assert.equal(opened.id, "D1"); assert.deepEqual(opened.to, ["cliente@example.com"]); assert.equal(opened.subject, "RE: Olá");
  const patch = calls.find(call => call.init.method === "PATCH").body;
  assert.equal(patch.toRecipients, undefined);
  assert.match(patch.body.content, /^<html><body><div id="rf-compose"><p>Olá<\/p><\/div><!--rf-quote--><hr>/);
  assert.equal((await draft.POST(request("draft", { id: "D1", mode: "reply", subject: "RE: Olá", to: [], cc: [], bcc: [], html: "x", quoteHtml: opened.quoteHtml, send: true }))).status, 400);
  const sent = await (await draft.POST(request("draft", { id: "D1", mode: "reply", subject: "RE: Olá", to: ["cliente@example.com"], cc: [], bcc: [], html: "<p>Até já</p>", quoteHtml: opened.quoteHtml, send: true }))).json();
  assert.equal(sent.sent, true);
  assert.ok(calls.some(call => call.url.pathname.endsWith("/messages/D1/send") && call.init.method === "POST"));
});

test("draft: an already sent message cannot be edited or discarded", async t => {
  const calls = mock(t, url => url.pathname.endsWith("/messages/S1") ? reply({ id: "S1", isDraft: false }) : null);
  assert.equal((await draft.DELETE(request("draft?id=S1", undefined, "DELETE"))).status, 409);
  assert.equal(calls.some(call => call.init.method === "DELETE"), false);
});
