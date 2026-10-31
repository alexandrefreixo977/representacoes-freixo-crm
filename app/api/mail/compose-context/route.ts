import { applicationToken, json, knownMail, mailError, mailSession } from "../server";
import { userSignature } from "../signature";
export async function GET(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const signature = await userSignature(db, user, new URL(request.url).origin);
    if (new URL(request.url).searchParams.get("signatureOnly") === "1") return json({ signature, userId: user.id });
    const ownAddresses = new Set([user.email.toLowerCase()]);
    let aliasesVerified = false;
    // Directory access is optional; never silently claim unknown aliases were checked.
    try {
      const token = await applicationToken();
      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.email)}?$select=mail,userPrincipalName,proxyAddresses`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok) {
        const account = await response.json();
        [account.mail, account.userPrincipalName, ...(account.proxyAddresses || []).filter((value: string) => /^smtp:/i.test(value)).map((value: string) => value.slice(5))].filter(Boolean).forEach(value => ownAddresses.add(value.toLowerCase()));
        aliasesVerified = Array.isArray(account.proxyAddresses);
      }
    } catch { /* Reading mail remains available without directory permissions. */ }
    let contacts: { email: string; name: string }[] = [], contactsUnavailable = false;
    try { const index = await knownMail(db); contacts = [...index].map(([email, matches]) => ({ email, name: matches[0]?.name || email })); } catch { contactsUnavailable = true; }
    return json({ signature, ownAddresses: [...ownAddresses], aliasesVerified, contacts, contactsUnavailable });
  } catch (error) { return mailError(error); }
}
