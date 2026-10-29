import type { Api } from "./api";
import { demoApi } from "./demo-api";
import { createSupabaseApi } from "./supabase-api";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Com as variáveis do Supabase definidas usa a base de dados real; sem elas, modo demonstração. */
export const api: Api = url && key ? createSupabaseApi(url, key) : demoApi;
