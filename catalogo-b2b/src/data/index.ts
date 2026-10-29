import type { Api } from "./api";
import { demoApi } from "./demo-api";
import { createSupabaseApi } from "./supabase-api";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Ligações de convite / recuperação de palavra-passe chegam com "#access_token=...&type=invite".
 * Lemos o tipo ANTES de o Supabase processar e limpar o endereço.
 */
const hash = new URLSearchParams(typeof location === "undefined" ? "" : location.hash.replace(/^#/, ""));
export const authLink = {
  type: hash.get("type") as "invite" | "recovery" | "signup" | "magiclink" | null,
  error: hash.get("error_description"),
};

/** Com as variáveis do Supabase definidas usa a base de dados real; sem elas, modo demonstração. */
export const api: Api = url && key ? createSupabaseApi(url, key) : demoApi;
