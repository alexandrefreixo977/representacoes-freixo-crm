import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Não herdar a configuração PostCSS/Tailwind do CRM (pasta acima).
  css: { postcss: {} },
  test: { environment: "node" },
} as never);
