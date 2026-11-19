import { applicationToken, json, MailError, mailError, mailSession, readGraph, readGraphUrl } from "../server";
import { validGraphId } from "../../../mail-content";
export const dynamic = "force-dynamic";

type GraphFolder = { id: string; displayName: string; parentFolderId?: string; childFolderCount?: number; unreadItemCount?: number; totalItemCount?: number };
export type MailFolder = GraphFolder & { wellKnown?: string; depth?: number };
const SELECT = "$select=id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount&$top=250";
const SPECIAL = ["inbox", "drafts", "sentitems", "deleteditems", "junkemail", "archive", "outbox"];
const LABELS: Record<string, string> = { inbox: "Caixa de Entrada", drafts: "Rascunhos", sentitems: "Itens Enviados", deleteditems: "Itens Eliminados", junkemail: "Lixo Eletrónico", archive: "Arquivo", outbox: "Caixa de Saída" };
// Folders Outlook keeps for its own features and never shows in the folder list.
const HIDDEN = /^(conversation history|histórico de conversações|sync issues|problemas de sincronização|rss feeds|feeds rss|scheduled|agendad[oa]s?)$/i;

async function children(token: string, email: string, parent: string) {
  const folders: GraphFolder[] = [];
  let page = await readGraph(token, email, `/mailFolders/${encodeURIComponent(parent)}/childFolders?${SELECT}`);
  for (let guard = 0; guard < 8; guard++) {
    folders.push(...(page.value as GraphFolder[]));
    if (!page["@odata.nextLink"]) break;
    page = await readGraphUrl(token, page["@odata.nextLink"]);
  }
  return folders.sort((a, b) => a.displayName.localeCompare(b.displayName, "pt", { numeric: true }));
}

export async function GET(request: Request) {
  try {
    const { user } = await mailSession(request);
    const params = new URL(request.url).searchParams;
    const parent = params.get("parent");
    const token = await applicationToken();
    if (parent) {
      if (!validGraphId(parent)) throw new MailError(400, "Pasta inválida.");
      return json({ folders: await children(token, user.email, parent) });
    }
    const [top, ...known] = await Promise.all([
      (async () => { const list: GraphFolder[] = []; let page = await readGraph(token, user.email, `/mailFolders?${SELECT}`); for (let guard = 0; guard < 8; guard++) { list.push(...(page.value as GraphFolder[])); if (!page["@odata.nextLink"]) break; page = await readGraphUrl(token, page["@odata.nextLink"]); } return list; })(),
      ...SPECIAL.map(name => readGraph(token, user.email, `/mailFolders/${name}?$select=id`).then(folder => [name, folder.id as string] as const).catch(() => [name, ""] as const)),
    ]);
    const ids = new Map(known.filter(([, id]) => id).map(([name, id]) => [id, name]));
    const folders: MailFolder[] = top.filter(folder => ids.has(folder.id) || !HIDDEN.test(folder.displayName)).map(folder => {
      const wellKnown = ids.get(folder.id);
      return { ...folder, ...(wellKnown ? { wellKnown, displayName: LABELS[wellKnown] } : {}) };
    });
    const rank = (folder: MailFolder) => folder.wellKnown ? SPECIAL.indexOf(folder.wellKnown) : 100;
    folders.sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName, "pt", { numeric: true }));
    if (params.get("all") === "1") {
      // Full tree for "Mover para" search: walk every folder that has subfolders.
      const queue = folders.filter(folder => folder.childFolderCount).map(folder => ({ folder, depth: 1 }));
      const extra: MailFolder[] = [];
      let calls = 0;
      while (queue.length && calls < 60) {
        const batch = queue.splice(0, 6); calls += batch.length;
        const results = await Promise.all(batch.map(item => children(token, user.email, item.folder.id).then(list => ({ list, depth: item.depth }))));
        for (const { list, depth } of results) for (const child of list) { extra.push({ ...child, depth }); if (child.childFolderCount) queue.push({ folder: child, depth: depth + 1 }); }
      }
      return json({ folders, all: extra, truncated: queue.length > 0 });
    }
    return json({ folders });
  } catch (error) { return mailError(error); }
}
