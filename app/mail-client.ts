import { supabase } from "./supabase";
export async function mailRequest(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("A sessão expirou. Inicie sessão novamente.");
  const response = await fetch(path, { ...init, cache: "no-store", headers: { ...init.headers, Authorization: "Bearer " + data.session.access_token } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível consultar o correio.");
  return result;
}
export async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
