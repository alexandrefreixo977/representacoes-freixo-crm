import { applicationToken, json, mailError, mailSession, readGraph } from "../server";
export const dynamic = "force-dynamic";
// Categories used in this mailbox (triage of 16/10/2026) when the master list is not readable.
const FALLBACK = [
  ["1 · Ação Alexandre", "preset0"], ["2 · Encomendas", "preset7"], ["3 · Cotações", "preset4"], ["4 · Cobranças", "preset1"],
  ["5 · Faturas e Comissões", "preset3"], ["6 · Fabricantes – Info", "preset8"], ["7 · Banco e Admin", "preset12"], ["8 · Newsletters", "preset13"], ["9 · Pessoal / Padel", "preset5"],
].map(([displayName, color]) => ({ displayName, color }));
export async function GET(request: Request) {
  try {
    const { user } = await mailSession(request);
    try {
      const token = await applicationToken();
      const result = await readGraph(token, user.email, "/outlook/masterCategories");
      const list = (result.value as { displayName: string; color: string }[]).map(({ displayName, color }) => ({ displayName, color }));
      return json({ categories: list.length ? list : FALLBACK, source: "outlook" });
    } catch { return json({ categories: FALLBACK, source: "crm" }); }
  } catch (error) { return mailError(error); }
}
