import assert from "node:assert/strict";
import test from "node:test";

import { generateEmailSignature } from "../app/email-signature.ts";

test("gera a mesma assinatura HTML e texto com os dados configurados", () => {
  const signature = generateEmailSignature({
    name: "Alexandre & Freixo",
    title: "Administrador",
    email: "afreixo@representacoesfreixo.com",
    phone: "+351 912 345 678",
    address: "Rua Exemplo <Porto>",
    postalCode: "4900-561",
    locality: "Viana do Castelo",
    country: "Portugal",
    qrUrl: "https://example.com/qr.png",
    enabled: true,
  }, "https://example.com/logo.png");

  assert.match(signature.html, /data-rf-email-signature="true"/);
  assert.match(signature.html, /ALEXANDRE &AMP; FREIXO/);
  assert.match(signature.html, /mailto:afreixo@representacoesfreixo\.com/);
  assert.match(signature.html, /tel:\+351912345678/);
  assert.match(signature.html, /https:\/\/example\.com\/logo\.png/);
  assert.match(signature.html, /width="133" height="78"/);
  assert.match(signature.html, /width="461"/);
  assert.match(signature.html, /font:bold 17px Arial/);
  assert.match(signature.html, /font:12px Arial/);
  assert.match(signature.html, /nowrap="nowrap"/);
  assert.match(signature.html, /SAFETY&nbsp;•&nbsp;TOOLS&nbsp;•&nbsp;INDUSTRIAL&nbsp;SOLUTIONS/);
  assert.match(signature.html, /MAIS SEGURANÇA\. MAIS VALOR\./);
  assert.match(signature.html, /representacoesfreixo\.com/);
  assert.match(signature.html, /4900-561 Viana do Castelo/);
  assert.doesNotMatch(signature.html, /PORTUGAL \| ANGOLA \| PALOPS/);
  assert.match(signature.html, /https:\/\/example\.com\/qr\.png/);
  assert.doesNotMatch(signature.html, /Rua Exemplo <Porto>/);
  assert.match(signature.text, /Alexandre & Freixo/);
  assert.match(signature.text, /\+351 912 345 678/);
});

test("omite campos vazios sem quebrar o modelo", () => {
  const signature = generateEmailSignature({ name: "Lúcia Costa", enabled: true }, "");
  assert.match(signature.html, /LÚCIA COSTA/);
  assert.doesNotMatch(signature.html, /mailto:|tel:|<img/);
  assert.equal(signature.text, "Lúcia Costa\nrepresentacoesfreixo.com");
});

test("adapta o layout sem QR Code nem telefone", () => {
  const signature = generateEmailSignature({
    name: "Tina Sciullo",
    email: "comercial@representacoesfreixo.com",
    enabled: true,
  }, "https://example.com/logo.png");
  assert.doesNotMatch(signature.html, /alt="QR Code"|tel:/);
  assert.match(signature.html, /mailto:comercial@representacoesfreixo\.com/);
  assert.equal((signature.html.match(/data-rf-email-signature/g) ?? []).length, 1);
});

test("não repete país ou localidade já presentes na morada antiga", () => {
  const signature = generateEmailSignature({
    name: "Alexandre Freixo",
    address: "Rua da Bandeira 595\n4900-561 Viana do Castelo\nPortugal",
    postalCode: "4900-561",
    locality: "Viana do Castelo",
    country: "Portugal",
    enabled: true,
  }, "logo.png");
  assert.equal((signature.html.match(/Portugal/g) ?? []).length, 1);
  assert.equal((signature.html.match(/4900-561 Viana do Castelo/g) ?? []).length, 1);
});

test("não gera assinatura quando está desativada", () => {
  assert.deepEqual(generateEmailSignature({ name: "Teste", enabled: false }, "logo.png"), { html: "", text: "" });
});
