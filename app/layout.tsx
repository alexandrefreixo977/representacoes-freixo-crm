import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./theme.css";
import "./manufacturer-actions.css";
import "./operational-dashboard.css";
import "./global-search.css";
import "./mailbox.css";
import "./dashboard-fixes.css";
import "./brand-theme.css";
import "./mobile-responsive.css";
import PwaRegister from "./pwa-register";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Representações Freixo CRM",
  description: "CRM comercial da Representações Freixo",
  manifest: "/manifest.webmanifest?v=5",
  applicationName: "Freixo CRM",
  appleWebApp: { capable: true, title: "Freixo CRM", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/favicon.ico?v=5", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/freixo-favicon-v2-32.png", sizes: "32x32", type: "image/png" },
      { url: "/freixo-app-icon-v2-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=5",
    apple: [{ url: "/freixo-apple-touch-icon-v2.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: { title: "Representações Freixo CRM", description: "Gestão de clientes, visitas comerciais e oportunidades.", images: ["/freixo-crm-cover.png"] },
};
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#24272d", colorScheme: "light" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-PT"><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" /></head><body className={geist.variable}><PwaRegister/>{children}</body></html>;
}
