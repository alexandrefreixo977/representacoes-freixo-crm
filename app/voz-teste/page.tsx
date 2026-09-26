"use client";

// Pagina de teste da camada de voz (Fase 2.1) — Freixo CRM.
//
// Objetivo: provar o "cerebro" com TEXTO, antes de acrescentar o microfone.
// Fluxo: escreve-se um comando -> "Interpretar" chama /api/voz -> mostra a acao
// proposta (ou uma pergunta) -> so depois de "Confirmar e gravar" e que grava
// na base de dados. Confirmar SEMPRE antes de escrever — nada e gravado sozinho.
//
// E uma rota autonoma (/voz-teste) para nao mexer na pagina principal (grande).

import { useEffect, useState } from "react";
import { supabase } from "../supabase";

type Cliente = { id: string; nome: string; codigo?: string };
type Acao = {
  tipo: "acao";
  acao: string;
  input: { cliente_id: string; cliente_nome: string; data: string; objetivo: string; notas?: string };
  resumo: string;
};
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

  // Carrega o utilizador e a carteira de clientes.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    supabase
      .from("clients")
      .select("id,trade_name,code")
      .order("trade_name")
      .then(({ data }) => {
        setClientes((data || []).map((c) => ({ id: c.id, nome: c.trade_name, codigo: c.code || undefined })));
      });
  }, []);

  async function interpretar() {
    setAviso("");
    setSucesso("");
    setResposta(null);
    if (!comando.trim()) {
      setAviso("Escreva um comando primeiro.");
      return;
    }
    setAInterpretar(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("A sessao terminou. Volte a iniciar sessao.");
      const res = await fetch("/api/voz", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          comando,
          clientes,
          hoje: new Date().toISOString().slice(0, 10),
        }),
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

  async function confirmar() {
    if (!resposta || resposta.tipo !== "acao" || !userId) return;
    setAGravar(true);
    setAviso("");
    try {
      const i = resposta.input;
      const { error } = await supabase.from("visits").insert({
        client_id: i.cliente_id,
        seller_id: userId,
        created_by: userId,
        scheduled_at: new Date(`${i.data}T09:00:00`).toISOString(),
        visit_type: "presencial",
        status: "planned",
        objective: i.objetivo,
        summary: i.notas || null,
      });
      if (error) throw new Error(error.message);
      setSucesso(`Visita registada: ${i.cliente_nome}, ${i.data}.`);
      setResposta(null);
      setComando("");
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "Nao foi possivel gravar a visita.");
    } finally {
      setAGravar(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: ".25rem" }}>Camada de voz — teste (texto)</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Escreva um comando, por exemplo: <em>&ldquo;regista visita ao cliente X amanha para apresentar a nova gama de luvas&rdquo;</em>.
        Nada e gravado sem a sua confirmacao.
      </p>

      <label style={{ display: "block", fontWeight: 600, marginTop: "1rem" }}>Comando</label>
      <textarea
        rows={3}
        value={comando}
        onChange={(e) => setComando(e.target.value)}
        placeholder="regista visita ao cliente ... para ..."
        style={{ width: "100%", padding: ".6rem", fontSize: "1rem", boxSizing: "border-box" }}
      />

      <button
        onClick={interpretar}
        disabled={aInterpretar}
        style={{ marginTop: ".75rem", padding: ".6rem 1.2rem", fontSize: "1rem", cursor: "pointer" }}
      >
        {aInterpretar ? "A interpretar…" : "Interpretar"}
      </button>

      <p style={{ color: "#888", fontSize: ".85rem" }}>{clientes.length} clientes carregados.</p>

      {aviso && (
        <div role="alert" style={{ marginTop: "1rem", padding: ".75rem", background: "#fdecea", color: "#8a1c14", borderRadius: 6 }}>
          {aviso}
        </div>
      )}

      {sucesso && (
        <div style={{ marginTop: "1rem", padding: ".75rem", background: "#e7f6ec", color: "#1b5e20", borderRadius: 6 }}>
          {sucesso}
        </div>
      )}

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
          <button
            onClick={confirmar}
            disabled={aGravar}
            style={{ padding: ".55rem 1.1rem", fontSize: "1rem", cursor: "pointer", background: "#1b5e20", color: "#fff", border: 0, borderRadius: 6 }}
          >
            {aGravar ? "A gravar…" : "Confirmar e gravar"}
          </button>
          <button
            onClick={() => setResposta(null)}
            disabled={aGravar}
            style={{ marginLeft: ".5rem", padding: ".55rem 1.1rem", fontSize: "1rem", cursor: "pointer" }}
          >
            Cancelar
          </button>
        </div>
      )}
    </main>
  );
}

