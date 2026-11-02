export type RecipientLists = { to: string[]; cc: string[]; bcc: string[] };
export type RecipientField = keyof RecipientLists;
export const recipientFields: RecipientField[] = ["to", "cc", "bcc"];
export const normalizeAddress = (value: string) => value.trim().toLowerCase();
export const validAddress = (value: string) => value.length <= 254 && !value.startsWith(".") && !value.includes("..") && !value.split("@")[0].endsWith(".") && /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value);
export const splitAddresses = (value: string) => value.split(/[;,\r\n]+/).map(normalizeAddress).filter(Boolean);
export function addRecipients(current: RecipientLists, field: RecipientField, input: string) {
  const values = splitAddresses(input);
  const invalid = values.find(value => !validAddress(value));
  if (invalid) return { recipients: current, error: `Endereço de email inválido: ${invalid}` };
  const used = new Set(recipientFields.flatMap(key => current[key]));
  const fresh: string[] = [];
  let duplicate = false;
  for (const value of values) { if (used.has(value)) duplicate = true; else { fresh.push(value); used.add(value); } }
  return { recipients: { ...current, [field]: [...current[field], ...fresh] }, error: duplicate ? "Este destinatário já está em Para, CC ou BCC; não foi repetido." : "" };
}
export function validateRecipients(input: Record<string, unknown>): RecipientLists {
  const result: RecipientLists = { to: [], cc: [], bcc: [] };
  const used = new Set<string>();
  for (const field of recipientFields) {
    const values = input[field] ?? [];
    if (!Array.isArray(values) || values.length > 50) throw new Error(`A lista ${field.toUpperCase()} deve conter até 50 endereços.`);
    for (const raw of values) {
      if (typeof raw !== "string" || !validAddress(normalizeAddress(raw))) throw new Error(`Existe um endereço inválido em ${field.toUpperCase()}.`);
      const address = normalizeAddress(raw);
      if (used.has(address)) throw new Error("Um destinatário está repetido entre Para, CC ou BCC.");
      used.add(address); result[field].push(address);
    }
  }
  if (!result.to.length) throw new Error("Adicione pelo menos um destinatário em Para.");
  if (used.size > 50) throw new Error("Pode enviar para até 50 destinatários no total.");
  return result;
}
