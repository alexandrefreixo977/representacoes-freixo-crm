import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmailSignature } from "../../email-signature";
import { MailError } from "./server";

export async function userSignature(db: SupabaseClient, user: { id: string; email: string }, origin: string) {
  const { data, error } = await db.from("profiles").select("full_name,signature_name,signature_title,signature_email,signature_phone,signature_address,signature_postal_code,signature_locality,signature_country,signature_qr_path,signature_enabled").eq("id", user.id).single();
  if (error || !data) throw new MailError(503, "Não foi possível carregar a sua assinatura. Tente novamente antes de enviar.");
  const warnings: string[] = [];
  const name = data.signature_name || data.full_name;
  const email = data.signature_email || user.email;
  if (data.signature_enabled !== false && (!data.signature_name || !data.signature_email)) warnings.push("Nome e/ou email da assinatura ainda não foram guardados. A pré-visualização usa esses dados reais do seu perfil e da conta autenticada.");
  const missing = [["função", data.signature_title], ["telefone/telemóvel", data.signature_phone], ["morada", data.signature_address], ["código postal", data.signature_postal_code], ["localidade", data.signature_locality], ["país", data.signature_country], ["QR Code", data.signature_qr_path]].filter(([, value]) => !value).map(([label]) => label);
  if (data.signature_enabled !== false && missing.length) warnings.push("Não configurado na assinatura: " + missing.join(", ") + ". Estes elementos não serão inventados nem incluídos.");
  if (data.signature_enabled !== false && (!name || !email)) throw new MailError(422, "Dados obrigatórios em falta na assinatura: " + [!name && "nome", !email && "email"].filter(Boolean).join(", ") + ". Configure-os na Área pessoal.");
  const qrUrl = data.signature_qr_path ? db.storage.from("email-signatures").getPublicUrl(data.signature_qr_path).data.publicUrl : "";
  if (qrUrl && !qrUrl.startsWith("https://")) throw new MailError(422, "O QR Code da assinatura necessita de um endereço HTTPS público.");
  const signature = generateEmailSignature({ name, email, title: data.signature_title, phone: data.signature_phone, address: data.signature_address, postalCode: data.signature_postal_code, locality: data.signature_locality, country: data.signature_country, qrUrl, enabled: data.signature_enabled }, `${origin}/email-signature-logo.png`);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature.html));
  return { ...signature, warnings, enabled: data.signature_enabled !== false, version: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("") };
}
