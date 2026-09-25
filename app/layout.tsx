import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./theme.css";
import "./manufacturer-actions.css";
import "./operational-dashboard.css";
import "./global-search.css";
import "./dashboard-fixes.css";
import PwaRegister from "./pwa-register";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Representações Freixo CRM",
  description: "CRM comercial da Representações Freixo",
  manifest: "/manifest.webmanifest",
  applicationName: "Freixo CRM",
  appleWebApp: { capable: true, title: "Freixo CRM", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
  openGraph: { title: "Representações Freixo CRM", description: "Gestão de clientes, visitas comerciais e oportunidades.", images: ["/freixo-crm-cover.png"] },
};
export const viewport = { themeColor: "#15314c", colorScheme: "light" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-PT"><body className={geist.variable}><PwaRegister/>{children}</body></html>; }
