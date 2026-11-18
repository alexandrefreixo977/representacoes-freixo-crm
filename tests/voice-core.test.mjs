import test from "node:test";
import assert from "node:assert/strict";
import { calendario, construirAcao, fonetico, normalizar, partesNoFuso, procurarClientes, respostaDeConfirmacao, validarData, validarHora } from "../app/voice-core.ts";

const clientes = [
  { id: "c1", codigo: "CLI0168", nome: "Ferragens Lamarão, Lda", nomeLegal: "Lamarão & Filhos Lda", cidade: "Braga" },
  { id: "c2", codigo: "CLI0055", nome: "Fonseca & Lúcia Ferramentas", cidade: "Viana do Castelo" },
  { id: "c3", codigo: "CLI0201", nome: "Drogaria Nogueira", cidade: "Ponte de Lima" },
  { id: "c4", codigo: "CLI0326", nome: "Casa Silva Unipessoal", cidade: "Porto" },
  { id: "c5", codigo: "CLI0327", nome: "Casa Silva & Sousa", cidade: "Barcelos" },
  { id: "c6", codigo: "CLI0400", nome: "Chavestock Indústria", cidade: "Guimarães" },
];
const contactos = [{ id: "p1", clienteId: "c3", nome: "Manuel Gonçalves", cargo: "Comprador" }];
const marcas = [{ id: "m1", nome: "COFRA" }, { id: "m2", nome: "JSP Safety" }, { id: "m3", nome: "UNIOR" }, { id: "m4", nome: "Röntgen" }];
const perfis = [{ id: "u1", nome: "Alexandre Freixo" }, { id: "u2", nome: "Tina Freixo", email: "comercial@x.pt" }];
const ctx = (extra = {}) => ({
  userId: "u1", timezone: "Europe/Lisbon", hoje: "2026-11-18", agoraISO: "2026-11-18T10:00:00.000Z",
  clientes, contactos, marcas, perfis,
  instante: (d, h) => new Date(`${d}T${h}:00Z`).toISOString(),
  atividadesConhecidas: new Map([["a1", { titulo: "Enviar proposta — Drogaria Nogueira", temHora: true, hora: "15:00" }]]),
  ...extra,
});

test("normaliza acentos, símbolos e espaços", () => {
  assert.equal(normalizar("  Lamarão & Filhos, Lda. "), "lamarao e filhos lda");
  assert.equal(fonetico("Chavestock"), fonetico("xabestoc"));
});

test("encontra clientes mesmo com o nome mal ditado", () => {
  assert.equal(procurarClientes("lamarão", clientes)[0].cliente.id, "c1");
  assert.equal(procurarClientes("ferragens lamarao de braga", clientes)[0].cliente.id, "c1");
  assert.equal(procurarClientes("fonseca e lucia", clientes)[0].cliente.id, "c2");
  assert.equal(procurarClientes("xavestoque", clientes)[0].cliente.id, "c6");
  assert.equal(procurarClientes("cli 326", clientes)[0].cliente.id, "c4");
  assert.equal(procurarClientes("drogaria nogeira", clientes)[0].cliente.id, "c3");
});

test("encontra o cliente pelo nome do contacto", () => {
  const r = procurarClientes("Manuel Gonçalves", clientes, contactos);
  assert.equal(r[0].cliente.id, "c3");
  assert.match(r[0].via, /contacto/);
});

test("datas e horas ditas", () => {
  assert.equal(validarHora("9"), "09:00");
  assert.equal(validarHora("14h30"), "14:30");
  assert.equal(validarHora("9.15"), "09:15");
  assert.equal(validarHora("25:00"), null);
  assert.equal(validarData("2026-02-30"), null);
  assert.equal(validarData("2026-11-20"), "2026-11-20");
  const cal = calendario("2026-11-18", 1, 3);
  assert.match(cal, /2026-11-18 quarta-feira ← HOJE/);
  assert.match(cal, /2026-11-20 sexta-feira/);
  assert.equal(partesNoFuso(new Date("2026-07-01T23:30:00Z"), "Europe/Lisbon").data, "2026-07-02");
});

test("agenda visita com hora, marca e cliente resolvido pelo nome", () => {
  const r = construirAcao("agendar_atividade", { cliente_nome: "lamarão", tipo: "Visita", data: "2026-11-20", hora: "10:00", assunto: "Apresentar a nova coleção", marca: "cofre" }, ctx());
  assert.equal(r.ok, true);
  const v = r.acao.operacoes[0].valores;
  assert.equal(v.client_id, "c1");
  assert.equal(v.kind, "visit");
  assert.equal(v.has_time, true);
  assert.equal(v.due_date, "2026-11-20");
  assert.equal(v.start_at, "2026-11-20T10:00:00.000Z");
  assert.equal(v.manufacturer_id, "m1");
  assert.equal(v.source_module, "visits");
  assert.match(r.acao.resumo, /sexta-feira, 20\/11 às 10:00/);
});

test("tarefa sem hora fica só com prazo (aparece nas tarefas e alertas)", () => {
  const r = construirAcao("criar_tarefa", { cliente_codigo: "CLI0201", titulo: "Enviar tabela", data: "2026-11-19", responsavel: "Tina" }, ctx());
  assert.equal(r.ok, true);
  const v = r.acao.operacoes[0].valores;
  assert.equal(v.has_time, false);
  assert.equal(v.start_at, null);
  assert.equal(v.due_date, "2026-11-19");
  assert.equal(v.assigned_to, "u2");
  assert.match(r.acao.resumo, /amanhã/);
});

test("cliente ambíguo devolve candidatos em vez de adivinhar", () => {
  const r = construirAcao("criar_tarefa", { cliente_nome: "casa silva", titulo: "Ligar", data: "2026-11-19" }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.erro, /CLI0326/);
  assert.match(r.erro, /CLI0327/);
});

test("interação passada com seguimento cria duas operações", () => {
  const r = construirAcao("registar_interacao", { cliente_codigo: "CLI0201", tipo: "Chamada telefónica", assunto: "Interessado em luvas", resultado: "Positivo", contacto: "Manuel", marca: "JSP", proxima_acao: "Enviar proposta", proxima_acao_data: "2026-11-25" }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.acao.operacoes.length, 2);
  assert.equal(r.acao.operacoes[0].valores.status, "completed");
  assert.equal(r.acao.operacoes[0].valores.contact_id, "p1");
  assert.equal(r.acao.operacoes[0].valores.manufacturer_id, "m2");
  assert.equal(r.acao.operacoes[1].valores.kind, "task");
  assert.equal(r.acao.operacoes[1].valores.due_date, "2026-11-25");
});

test("reagendar mantém a hora e só aceita atividades reais", () => {
  const r = construirAcao("reagendar_atividade", { atividade_id: "a1", data: "2026-11-19" }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.acao.operacoes[0].id, "a1");
  assert.equal(r.acao.operacoes[0].valores.start_at, "2026-11-19T15:00:00.000Z");
  assert.equal(construirAcao("concluir_atividade", { atividade_id: "inventado" }, ctx()).ok, false);
  const c = construirAcao("concluir_atividade", { atividade_id: "a1" }, ctx());
  assert.equal(c.acao.operacoes[0].valores.status, "completed");
});

test("abrir ficha de cliente navega para a ficha", () => {
  const r = construirAcao("abrir_ecra", { cliente_nome: "nogueira" }, ctx());
  assert.equal(r.acao.destino, "/clientes/c3");
  assert.equal(construirAcao("abrir_ecra", { ecra: "agenda" }, ctx()).acao.destino, "/agenda");
});

test("confirmação por voz", () => {
  assert.equal(respostaDeConfirmacao("Sim, confirma"), "sim");
  assert.equal(respostaDeConfirmacao("Grava."), "sim");
  assert.equal(respostaDeConfirmacao("não, cancela"), "nao");
  assert.equal(respostaDeConfirmacao("marca visita ao lamarão amanhã às 10 para levar amostras"), null);
});
