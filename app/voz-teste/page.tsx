"use client";

import { useEffect, useState } from "react";
import { supabase } from "../supabase";

type Cliente = { id: string; nome: string; codigo?: string };
type Acao = { tipo: "acao"; acao: string; input: Record<string, string>; resumo: string };
type Pergunta = { tipo: "pergunta"; texto: string };
type Resposta = Acao | Pergunta;

export default function VozTeste() {
  const [userId, setUserId] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [comando, setComando] = useState("");
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [aInterpretar, setAInterpretar] = useState(false);
  const [aGravar, setAGravar] = useState(false);
  const [aviso, setAviso] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [aOuvir, setAOuvir] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    supabase.from("clients").select("id,trade_name,code").order("trade_name").then(({ data }) => {
      setClientes((data || []).map((c) => ({ id: c.id, nome: c.trade_name, codigo: c.code || undefined })));
    });
  }, []);

  async function interpretar(textoOverride?: string) {
    const texto = (textoOverride ?? comando).trim();
    setAviso(""); setSucesso(""); setResposta(null);
    if (!texto) { setAviso("Escreva ou dite um comando primeiro."); return; }
    setAInterpretar(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("A sessao terminou. Volte a iniciar sessao.");
      const res = await fetch("/api/voz", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comando: texto, clientes, hoje: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Nao foi possivel interpretar o comando.");
      setResposta(data as Resposta);
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
      const quando = new Date(`${dataBase}T09:00:00`).toISOString();
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
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "Nao foi possivel gravar.");
    } finally {
      setAGravar(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: ".25rem" }}>Camada de voz</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Fale ou escreva um comando. Sabe fazer: <strong>registar visita</strong>, <strong>criar tarefa</strong> e <strong>registar chamada</strong>.
        Ex.: &ldquo;regista visita ao cliente X amanha para apresentar as luvas&rdquo;, &ldquo;cria tarefa de enviar proposta ao cliente Y na sexta&rdquo;, &ldquo;liguei ao cliente Z sobre a encomenda&rdquo;.
        Nada e gravado sem a sua confirmacao.
      </p>

      <label style={{ display: "block", fontWeight: 600, marginTop: "1rem" }}>Comando</label>
      <textarea rows={3} value={comando} onChange={(e) => setComando(e.target.value)} placeholder="regista visita ao cliente ... para ..." style={{ width: "100%", padding: ".6rem", fontSize: "1rem", boxSizing: "border-box" }} />

      <div style={{ marginTop: ".75rem", display: "flex", gap: ".5rem", alignItems: "center" }}>
        <button onClick={ditar} disabled={aOuvir || aInterpretar} style={{ padding: ".6rem 1.2rem", fontSize: "1rem", cursor: "pointer", background: aOuvir ? "#c62828" : "#1b5e20", color: "#fff", border: 0, borderRadius: 6 }}>
          {aOuvir ? "🔴 A ouvir… fale agora" : "🎤 Falar"}
        </button>
        <button onClick={() => interpretar()} disabled={aInterpretar || aOuvir} style={{ padding: ".6rem 1.2rem", fontSize: "1rem", cursor: "pointer" }}>
          {aInterpretar ? "A interpretar…" : "Interpretar"}
        </button>
      </div>

      <p style={{ color: "#888", fontSize: ".85rem" }}>{clientes.length} clientes carregados. Ditar por voz requer o Chrome e autorizacao do microfone.</p>

      {aviso && <div role="alert" style={{ marginTop: "1rem", padding: ".75rem", background: "#fdecea", color: "#8a1c14", borderRadius: 6 }}>{aviso}</div>}
      {sucesso && <div style={{ marginTop: "1rem", padding: ".75rem", background: "#e7f6ec", color: "#1b5e20", borderRadius: 6 }}>{sucesso}</div>}

      {resposta?.tipo === "pergunta" && (
        <div style={{ marginTop: "1rem", padding: ".9rem", background: "#fff8e1", borderRadius: 6 }}>
          <strong>Preciso de esclarecer:</strong>
          <p style={{ margin: ".4rem 0 0" }}>{resposta.texto}</p>
        </div>
      )}

      {resposta?.tipo === "acao" && (
        <div style={{ marginTop: "1rem", padding: ".9rem", background: "#eef3fb", borderRadius: 6 }}>
          <strong>Vou fazer isto:</strong>
          <p style={{ margin: ".4rem 0 .8rem" }}>{resposta.resumo}</p>
          <button onClick={confirmar} disabled={aGravar} style={{ padding: ".55rem 1.1rem", fontSize: "1rem", cursor: "pointer", background: "#1b5e20", color: "#fff", border: 0, borderRadius: 6 }}>
            {aGravar ? "A gravar…" : "Confirmar e gravar"}
          </button>
          <button onClick={() => setResposta(null)} disabled={aGravar} style={{ marginLeft: ".5rem", padding: ".55rem 1.1rem", fontSize: "1rem", cursor: "pointer" }}>
            Cancelar
          </button>
        </div>
      )}
    </main>
  );
}

