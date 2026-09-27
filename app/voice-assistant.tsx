"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Cliente = { id: string; nome: string; codigo?: string };
type Acao = { tipo: "acao"; acao: string; input: Record<string, string>; resumo: string };
type Pergunta = { tipo: "pergunta"; texto: string };
type RespostaTexto = { tipo: "resposta"; texto: string };
type Resposta = Acao | Pergunta | RespostaTexto;

function falar(texto: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "pt-PT";
    synth.speak(u);
  } catch { /* sem voz, sem problema */ }
}

export default function VoiceAssistant({ session, onSaved }: { session: Session | null; onSaved?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [comando, setComando] = useState("");
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [aInterpretar, setAInterpretar] = useState(false);
  const [aGravar, setAGravar] = useState(false);
  const [aOuvir, setAOuvir] = useState(false);
  const [aviso, setAviso] = useState("");
  const [sucesso, setSucesso] = useState("");

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!aberto || clientes.length) return;
    supabase.from("clients").select("id,trade_name,code").order("trade_name").then(({ data }) => {
      setClientes((data || []).map((c) => ({ id: c.id, nome: c.trade_name, codigo: c.code || undefined })));
    });
  }, [aberto, clientes.length]);

  function limpar() { setComando(""); setResposta(null); setAviso(""); setSucesso(""); }

  async function interpretar(textoOverride?: string) {
    const texto = (textoOverride ?? comando).trim();
    setAviso(""); setSucesso(""); setResposta(null);
    if (!texto) { setAviso("Fale ou escreva um comando primeiro."); return; }
    setAInterpretar(true);
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const jwt = s?.access_token;
      if (!jwt) throw new Error("A sessao terminou. Volte a iniciar sessao.");
      const res = await fetch("/api/voz", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comando: texto, clientes, hoje: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Nao foi possivel interpretar o comando.");
      setResposta(data as Resposta);
      if (data?.tipo === "resposta" && data.texto) falar(data.texto);
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "Nao foi possivel interpretar o comando.");
    } finally {
      setAInterpretar(false);
    }
  }

  function ditar() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setAviso("Este navegador nao suporta ditado por voz. Use o Chrome, ou escreva o comando."); return; }
    setAviso(""); setSucesso(""); setResposta(null);
    const rec = new SR();
    rec.lang = "pt-PT"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let transcricao = "";
    rec.onresult = (event: any) => { transcricao = Array.from(event.results).map((r: any) => r[0].transcript).join(" ").trim(); setComando(transcricao); };
    rec.onerror = () => { setAOuvir(false); setAviso("Nao consegui ouvir ou o microfone nao foi autorizado. Tente de novo."); };
    rec.onend = () => { setAOuvir(false); if (transcricao.trim()) interpretar(transcricao); };
    setAOuvir(true);
    rec.start();
  }

  async function confirmar() {
    if (!resposta || resposta.tipo !== "acao" || !userId) return;
    setAGravar(true); setAviso("");
    try {
      const i = resposta.input;
      const dataBase = i.data || new Date().toISOString().slice(0, 10);
      const horaBase = /^\d{1,2}:\d{2}$/.test(i.hora || "") ? i.hora.padStart(5, "0") : "09:00";
      const quando = new Date(`${dataBase}T${horaBase}:00`).toISOString();
      let payload: Record<string, unknown>;
      let mensagem: string;

      if (resposta.acao === "criar_tarefa") {
        payload = { client_id: i.cliente_id, kind: "task", interaction_type: "Tarefa", title: i.titulo, summary: i.titulo, actor_id: userId, assigned_to: userId, start_at: quando, occurred_at: quando, status: "scheduled", source_module: "tasks" };
        mensagem = `Tarefa criada: "${i.titulo}" (${i.cliente_nome}), prazo ${dataBase}.`;
      } else if (resposta.acao === "registar_chamada") {
        payload = { client_id: i.cliente_id, kind: "call", interaction_type: "Chamada telefónica", title: i.assunto, subject: i.assunto, summary: i.assunto, description: i.notas || null, actor_id: userId, assigned_to: userId, start_at: quando, occurred_at: quando, status: "completed", source_module: "client", updated_at: new Date().toISOString() };
        mensagem = `Chamada registada: ${i.cliente_nome} — ${i.assunto}.`;
      } else {
        payload = { client_id: i.cliente_id, kind: "visit", interaction_type: "Visita", title: "Visita comercial", summary: "Visita comercial", description: i.objetivo + (i.notas ? ` — ${i.notas}` : ""), actor_id: userId, assigned_to: userId, start_at: quando, occurred_at: quando, status: "scheduled", source_module: "visits" };
        mensagem = `Visita registada: ${i.cliente_nome}, ${dataBase}.`;
      }

      const { error } = await supabase.from("activities").insert(payload);
      if (error) throw new Error(error.message);
      setSucesso(mensagem); setResposta(null); setComando("");
      onSaved?.();
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "Nao foi possivel gravar.");
    } finally {
      setAGravar(false);
    }
  }

  if (!session) return null;

  return (
    <>
      <button aria-label="Assistente de voz" onClick={() => setAberto(true)} style={{ position: "fixed", right: 24, bottom: 24, zIndex: 900, width: 60, height: 60, borderRadius: "50%", border: 0, cursor: "pointer", background: "#b8860b", color: "#fff", fontSize: 26, boxShadow: "0 6px 18px rgba(0,0,0,.25)" }}>🎤</button>

      {aberto && (
        <div role="presentation" onClick={() => setAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-label="Assistente de voz" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 20px 60px rgba(0,0,0,.3)", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "1.1rem" }}>Assistente de voz</strong>
              <button onClick={() => setAberto(false)} aria-label="Fechar" style={{ border: 0, background: "transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <p style={{ color: "#555", fontSize: ".9rem", margin: ".4rem 0 .8rem" }}>Pergunte (ex.: "que visitas tenho amanha?") ou peca uma acao: <strong>registar visita</strong>, <strong>criar tarefa</strong>, <strong>registar chamada</strong>. As acoes pedem confirmacao antes de gravar.</p>
            <textarea rows={3} value={comando} onChange={(e) => setComando(e.target.value)} placeholder="ex.: cria tarefa de enviar proposta ao cliente ... na sexta" style={{ width: "100%", padding: ".6rem", fontSize: "1rem", boxSizing: "border-box", borderRadius: 6, border: "1px solid #ccc" }} />
            <div style={{ marginTop: ".6rem", display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <button onClick={ditar} disabled={aOuvir || aInterpretar} style={{ padding: ".55rem 1rem", fontSize: "1rem", cursor: "pointer", background: aOuvir ? "#c62828" : "#1b5e20", color: "#fff", border: 0, borderRadius: 6 }}>{aOuvir ? "🔴 A ouvir…" : "🎤 Falar"}</button>
              <button onClick={() => interpretar()} disabled={aInterpretar || aOuvir} style={{ padding: ".55rem 1rem", fontSize: "1rem", cursor: "pointer", borderRadius: 6, border: "1px solid #b8860b", background: "#fff" }}>{aInterpretar ? "A interpretar…" : "Interpretar"}</button>
              {(comando || resposta || sucesso) && <button onClick={limpar} style={{ padding: ".55rem 1rem", fontSize: "1rem", cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#fff", marginLeft: "auto" }}>Limpar</button>}
            </div>
            {aviso && <div role="alert" style={{ marginTop: ".8rem", padding: ".7rem", background: "#fdecea", color: "#8a1c14", borderRadius: 6 }}>{aviso}</div>}
            {sucesso && <div style={{ marginTop: ".8rem", padding: ".7rem", background: "#e7f6ec", color: "#1b5e20", borderRadius: 6 }}>{sucesso} <span style={{ color: "#4b6b50" }}>Atualize a página para o ver na lista.</span></div>}
            {resposta?.tipo === "resposta" && (
              <div style={{ marginTop: ".8rem", padding: ".8rem", background: "#eef7f1", borderRadius: 6 }}>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{resposta.texto}</p>
              </div>
            )}
            {resposta?.tipo === "pergunta" && <div style={{ marginTop: ".8rem", padding: ".8rem", background: "#fff8e1", borderRadius: 6 }}><strong>Preciso de esclarecer:</strong><p style={{ margin: ".4rem 0 0" }}>{resposta.texto}</p></div>}
            {resposta?.tipo === "acao" && <div style={{ marginTop: ".8rem", padding: ".8rem", background: "#eef3fb", borderRadius: 6 }}><strong>Vou fazer isto:</strong><p style={{ margin: ".4rem 0 .8rem" }}>{resposta.resumo}</p><button onClick={confirmar} disabled={aGravar} style={{ padding: ".55rem 1.1rem", fontSize: "1rem", cursor: "pointer", background: "#1b5e20", color: "#fff", border: 0, borderRadius: 6 }}>{aGravar ? "A gravar…" : "Confirmar e gravar"}</button><button onClick={() => setResposta(null)} disabled={aGravar} style={{ marginLeft: ".5rem", padding: ".55rem 1.1rem", fontSize: "1rem", cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#fff" }}>Cancelar</button></div>}
            <p style={{ color: "#999", fontSize: ".78rem", marginTop: ".9rem", marginBottom: 0 }}>{clientes.length} clientes · o ditado por voz requer o Chrome e microfone autorizado.</p>
          </div>
        </div>
      )}
    </>
  );
}

