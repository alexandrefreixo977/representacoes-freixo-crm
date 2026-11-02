import { json } from "../server";
// Tombstone for old browser tabs: never import or write mail again.
export async function POST() {
  return json({ error: "O Correio agora lê o Outlook ao vivo. Reabra o menu Correio." }, 410);
}
