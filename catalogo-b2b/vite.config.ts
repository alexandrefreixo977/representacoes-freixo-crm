import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Gera /visitas.js (contador para o site institucional) com o endereço e a chave pública do Supabase da loja. */
function visitsScript(mode: string): Plugin {
  return {
    name: "freixo-visitas",
    apply: "build",
    generateBundle() {
      const env = { ...process.env, ...loadEnv(mode, process.cwd(), "VITE_") };
      const url = env.VITE_SUPABASE_URL ?? "";
      const key = env.VITE_SUPABASE_ANON_KEY ?? "";
      if (!url || !key) return;
      const code = readFileSync(new URL("./scripts/visitas.template.js", import.meta.url), "utf8")
        .replaceAll("__URL__", url.replace(/\/$/, ""))
        .replaceAll("__KEY__", key);
      this.emitFile({ type: "asset", fileName: "visitas.js", source: code });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), visitsScript(mode)],
  // Não herdar a configuração PostCSS/Tailwind do CRM (pasta acima).
  css: { postcss: {} },
  test: { environment: "node" },
}) as never);
