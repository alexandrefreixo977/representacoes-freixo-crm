"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { respostaDeConfirmacao, type AcaoVoz } from "./voice-core";

type Acao = AcaoVoz & { id: string };
type Linha = { papel: "utilizador" | "assistente"; texto: string };
type Estado = "pendente" | "gravada" | "cancelada" | "erro";

const SILENCIO_MS = 1800; // pausa que termina o ditado
const MAX_DITADO_MS = 30000;

function vozPt(): SpeechSynthesisVoice | null {
  try {
    const vozes = window.speechSynthesis?.getVoices() ?? [];
    return vozes.find((v) => v.lang === "pt-PT") ?? vozes.find((v) => v.lang?.toLowerCase().startsWith("pt-pt")) ?? vozes.find((v) => v.lang?.toLowerCase().startsWith("pt")) ?? null;
  } catch { return null; }
}

function falar(texto: string, depois?: () => void) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !texto) { depois?.(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(texto.replace(/\bCLI\d+\b/g, ""));
    u.lang = "pt-PT";
    const v = vozPt();
    if (v) u.voice = v;
    u.rate = 1.05;
    if (depois) { u.onend = () => depois(); u.onerror = () => depois(); }
    synth.speak(u);
  } catch { depois?.(); }
}

function navegar(destino: string) {
  window.history.pushState({}, "", destino);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const ERROS_MIC: Record<string, string> = {
  "not-allowed": "O microfone não está autorizado. Autorize-o no navegador (cadeado na barra de endereço) e tente de novo.",
  "service-not-allowed": "O ditado por voz está bloqueado neste navegador. Use o Chrome, o Edge ou o Safari, ou escreva o comando.",
  "audio-capture": "Não encontrei nenhum microfone ligado.",
  "network": "O ditado precisa de internet e a ligação falhou. Tente de novo ou escreva o comando.",
  "language-not-supported": "Este navegador não tem ditado em português de Portugal.",
};

export default function VoiceAssistant({ session, embutido = false }: { session: Session | null; embutido?: boolean }) {
  const [aberto, setAberto] = useState(embutido);
  const [comando, setComando] = useState("");
  const [provisorio, setProvisorio] = useState("");
  const [conversa, setConversa] = useState<Linha[]>([]);
  const [memoria, setMemoria] = useState("");
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aInterpretar, setAInterpretar] = useState(false);
  const [aGravar, setAGravar] = useState(false);
  const [aOuvir, setAOuvir] = useState(false);
  const [aviso, setAviso] = useState("");
  const [vozLigada, setVozLigada] = useState(true);
  const [timezone, setTimezone] = useState("Europe/Lisbon");
  const reconhecimento = useRef<any>(null);
  const fimConversa = useRef<HTMLDivElement>(null);
  const pendentesRef = useRef<Acao[]>([]);

  const userId = session?.user.id ?? null;
  const pendentes = acoes.filter((a) => (estados[a.id] ?? "pendente") === "pendente" || estados[a.id] === "erro");
  pendentesRef.current = pendentes;

  useEffect(() => {
    const t = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === "string" && d) setTimezone(d); };
    window.addEventListener("crm-timezone", t);
    try { window.speechSynthesis?.getVoices(); } catch { /* carrega as vozes */ }
    try { const v = window.localStorage.getItem("crm-voz-ligada"); if (v === "0") setVozLigada(false); } catch { /* sem armazenamento */ }
    return () => window.removeEventListener("crm-timezone", t);
  }, []);
  useEffect(() => { fimConversa.current?.scrollIntoView({ block: "nearest" }); }, [conversa, acoes, aInterpretar]);
  useEffect(() => () => { try { reconhecimento.current?.abort(); } catch { /* nada */ } }, []);

  function limpar() {
    setComando(""); setProvisorio(""); setConversa([]); setMemoria(""); setAcoes([]); setEstados({}); setErros({}); setAviso("");
    try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
  }

  const executar = useCallback(async (lista: Acao[]) => {
    if (!userId || !lista.length) return;
    setAGravar(true); setAviso("");
    let gravadas = 0;
    for (const acao of lista) {
      try {
        for (const op of acao.operacoes) {
          const r = op.op === "insert"
            ? await supabase.from(op.tabela).insert(op.valores)
            : await supabase.from(op.tabela).update(op.valores).eq("id", op.id);
          if (r.error) throw new Error(r.error.message);
        }
        gravadas++;
        setEstados((s) => ({ ...s, [acao.id]: "gravada" }));
        setErros((e) => { const n = { ...e }; delete n[acao.id]; return n; });
      } catch (error) {
        setEstados((s) => ({ ...s, [acao.id]: "erro" }));
        setErros((e) => ({ ...e, [acao.id]: error instanceof Error ? error.message : "Não foi possível gravar." }));
      }
    }
    setAGravar(false);
    if (gravadas) {
      window.dispatchEvent(new Event("crm-records-changed"));
      const msg = gravadas === lista.length ? (gravadas === 1 ? "Gravado." : `Gravadas ${gravadas} ações.`) : `Gravei ${gravadas} de ${lista.length}. Veja o erro na que falhou.`;
      setConversa((c) => [...c, { papel: "assistente", texto: msg }]);
      if (vozLigada) falar(msg);
    }
  }, [userId, vozLigada]);

  function cancelar(lista: Acao[]) {
    setEstados((s) => { const n = { ...s }; for (const a of lista) n[a.id] = "cancelada"; return n; });
    setConversa((c) => [...c, { papel: "assistente", texto: "Cancelado, não gravei nada." }]);
    if (vozLigada) falar("Cancelado.");
  }

  async function interpretar(textoDito?: string, alternativas: string[] = []) {
    const texto = (textoDito ?? comando).trim();
    setAviso("");
    if (!texto) { setAviso("Fale ou escreva um comando primeiro."); return; }

    // "Confirma" / "cancela" por voz quando há ações à espera.
    const pend = pendentesRef.current;
    if (pend.length) {
      const r = respostaDeConfirmacao(texto);
      if (r) {
        setConversa((c) => [...c, { papel: "utilizador", texto }]); setComando(""); setProvisorio("");
        if (r === "sim") await executar(pend); else cancelar(pend);
        return;
      }
    }

    const historico: Linha[] = [...conversa.slice(-10)];
    if (memoria) historico.push({ papel: "assistente", texto: memoria });
    if (pend.length) historico.push({ papel: "assistente", texto: `Ainda por confirmar: ${pend.map((a) => a.resumo).join(" | ")}` });
    setConversa((c) => [...c, { papel: "utilizador", texto }]);
    setComando(""); setProvisorio("");
    setAInterpretar(true);
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const jwt = s?.access_token;
      if (!jwt) throw new Error("A sessão terminou. Volte a iniciar sessão.");
      const res = await fetch("/api/voz", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comando: texto, alternativas, historico, timezone }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Não foi possível interpretar o comando.");
      const novas: Acao[] = data.acoes ?? [];
      // As ações pendentes anteriores que não foram confirmadas ficam substituídas por um pedido novo.
      if (pend.length && novas.some((a) => a.tipo !== "navegar")) setEstados((s) => { const n = { ...s }; for (const a of pend) if (n[a.id] !== "erro") n[a.id] = "cancelada"; return n; });
      for (const a of novas) if (a.tipo === "navegar" && a.destino) { navegar(a.destino); if (!embutido) setAberto(false); }
      setAcoes((x) => [...x, ...novas.filter((a) => a.tipo !== "navegar")]);
      setMemoria(data.memoria || memoria);
      const resposta = String(data.texto || "");
      setConversa((c) => [...c, { papel: "assistente", texto: resposta }]);
      if (vozLigada && resposta) falar(resposta);
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "Não foi possível interpretar o comando.");
    } finally {
      setAInterpretar(false);
    }
  }

  function parar() {
    try { reconhecimento.current?.stop(); } catch { /* nada */ }
  }

  function ditar() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setAviso("Este navegador não tem ditado por voz. Use o Chrome, o Edge ou o Safari (iPhone), ou escreva o comando."); return; }
    if (aOuvir) { parar(); return; }
    try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
    setAviso("");
    const rec = new SR();
    reconhecimento.current = rec;
    rec.lang = "pt-PT"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 3;
    let finais: string[][] = []; // cada segmento final com as suas alternativas
    let silencio: ReturnType<typeof setTimeout> | undefined;
    const limite = setTimeout(() => { try { rec.stop(); } catch { /* nada */ } }, MAX_DITADO_MS);
    const armar = () => { if (silencio) clearTimeout(silencio); silencio = setTimeout(() => { try { rec.stop(); } catch { /* nada */ } }, SILENCIO_MS); };
    rec.onresult = (event: any) => {
      finais = [];
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finais.push(Array.from({ length: r.length }, (_, k) => String(r[k]?.transcript ?? "").trim()));
        else interim += ` ${r[0]?.transcript ?? ""}`;
      }
      const base = finais.map((f) => f[0]).join(" ").replace(/\s+/g, " ").trim();
      setProvisorio(`${base} ${interim}`.replace(/\s+/g, " ").trim());
      armar();
    };
    rec.onerror = (e: any) => {
      if (e?.error === "no-speech") setAviso("Não ouvi nada. Toque em Falar e diga o comando.");
      else if (e?.error !== "aborted") setAviso(ERROS_MIC[e?.error] ?? "Não consegui ouvir. Tente de novo ou escreva o comando.");
    };
    rec.onend = () => {
      clearTimeout(limite); if (silencio) clearTimeout(silencio);
      setAOuvir(false); reconhecimento.current = null;
      const texto = finais.map((f) => f[0]).join(" ").replace(/\s+/g, " ").trim();
      const alternativas = [1, 2].map((k) => finais.map((f) => f[k] || f[0]).join(" ").replace(/\s+/g, " ").trim()).filter((a) => a && a !== texto);
      setProvisorio("");
      if (texto) { setComando(texto); void interpretar(texto, [...new Set(alternativas)]); }
    };
    setAOuvir(true); setProvisorio("");
    try { rec.start(); armar(); } catch { setAOuvir(false); setAviso("Não foi possível ligar o microfone. Tente de novo."); }
  }

  function alternarVoz() {
    const v = !vozLigada; setVozLigada(v);
    if (!v) try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
    try { window.localStorage.setItem("crm-voz-ligada", v ? "1" : "0"); } catch { /* sem armazenamento */ }
  }

  if (!session) return null;

  const corEstado: Record<Estado, string> = { pendente: "#eef3fb", gravada: "#e7f6ec", cancelada: "#f3f3f3", erro: "#fdecea" };
  const btn = { padding: ".55rem 1rem", fontSize: "1rem", cursor: "pointer", borderRadius: 6 } as const;

  const painel = (
    <div role="dialog" aria-modal={!embutido} aria-label="Assistente de voz" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, maxHeight: embutido ? undefined : "90vh", display: "flex", flexDirection: "column", background: "#fff", color: "#222", borderRadius: 12, padding: "1.1rem", boxShadow: embutido ? "none" : "0 20px 60px rgba(0,0,0,.3)", fontFamily: "system-ui, sans-serif", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: "1.1rem" }}>Assistente de voz</strong>
        <span style={{ display: "flex", gap: 4 }}>
          <button onClick={alternarVoz} aria-label={vozLigada ? "Desligar respostas faladas" : "Ligar respostas faladas"} title={vozLigada ? "Respostas faladas: ligadas" : "Respostas faladas: desligadas"} style={{ border: 0, background: "transparent", fontSize: 20, cursor: "pointer" }}>{vozLigada ? "🔊" : "🔇"}</button>
          {!embutido && <button onClick={() => { parar(); setAberto(false); }} aria-label="Fechar" style={{ border: 0, background: "transparent", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", margin: ".5rem 0", minHeight: 60 }}>
        {!conversa.length && !aOuvir && (
          <div style={{ color: "#555", fontSize: ".88rem", lineHeight: 1.45 }}>
            Fale naturalmente. Por exemplo:
            <ul style={{ margin: ".3rem 0 0", paddingLeft: "1.1rem" }}>
              <li>“Marca visita à Ferragens Lima sexta às 10 para apresentar a Cofra”</li>
              <li>“Liguei ao Sr. Manuel da Casa Silva, ficou de encomendar luvas JSP, lembra-me de ligar dia 25”</li>
              <li>“O que tenho amanhã?” · “Que tarefas estão atrasadas?”</li>
              <li>“Passa a visita de amanhã ao Lamarão para quinta” · “Conclui a tarefa da proposta Nogueira”</li>
              <li>“Qual é o telefone da Drogaria Central?” · “Abre a ficha do Fonseca”</li>
            </ul>
            Nada é gravado sem confirmar (no botão ou dizendo “confirma”).
          </div>
        )}
        {conversa.map((l, i) => (
          <div key={i} style={{ display: "flex", justifyContent: l.papel === "utilizador" ? "flex-end" : "flex-start", margin: ".35rem 0" }}>
            <div style={{ maxWidth: "88%", padding: ".5rem .7rem", borderRadius: 10, whiteSpace: "pre-wrap", fontSize: ".95rem", background: l.papel === "utilizador" ? "#b8860b" : "#f1f3f5", color: l.papel === "utilizador" ? "#fff" : "#222" }}>{l.texto}</div>
          </div>
        ))}
        {acoes.length > 0 && (
          <div style={{ marginTop: ".5rem", display: "grid", gap: ".4rem" }}>
            {acoes.map((a) => {
              const e = estados[a.id] ?? "pendente";
              return (
                <div key={a.id} style={{ padding: ".55rem .7rem", borderRadius: 8, background: corEstado[e], fontSize: ".92rem", opacity: e === "cancelada" ? 0.6 : 1 }}>
                  <div style={{ textDecoration: e === "cancelada" ? "line-through" : undefined }}>{e === "gravada" ? "✅ " : e === "erro" ? "⚠️ " : "📝 "}{a.resumo}</div>
                  {erros[a.id] && <div style={{ color: "#8a1c14", fontSize: ".85rem", marginTop: 4 }}>{erros[a.id]}</div>}
                  {(e === "pendente" || e === "erro") && (
                    <div style={{ marginTop: ".4rem", display: "flex", gap: ".4rem" }}>
                      <button onClick={() => executar([a])} disabled={aGravar} style={{ ...btn, padding: ".3rem .7rem", fontSize: ".88rem", background: "#1b5e20", color: "#fff", border: 0 }}>{e === "erro" ? "Tentar de novo" : "Confirmar"}</button>
                      <button onClick={() => setEstados((s) => ({ ...s, [a.id]: "cancelada" }))} disabled={aGravar} style={{ ...btn, padding: ".3rem .7rem", fontSize: ".88rem", border: "1px solid #ccc", background: "#fff" }}>Cancelar</button>
                    </div>
                  )}
                </div>
              );
            })}
            {pendentes.length > 1 && <button onClick={() => executar(pendentes)} disabled={aGravar} style={{ ...btn, background: "#1b5e20", color: "#fff", border: 0 }}>{aGravar ? "A gravar…" : `Confirmar as ${pendentes.length}`}</button>}
          </div>
        )}
        {aInterpretar && <p style={{ color: "#777", fontSize: ".9rem", margin: ".5rem 0" }}>A pensar…</p>}
        {aOuvir && <p style={{ color: "#c62828", fontSize: ".95rem", margin: ".5rem 0" }}>🔴 {provisorio || "A ouvir… fale agora"}</p>}
        <div ref={fimConversa} />
      </div>

      {aviso && <div role="alert" style={{ marginBottom: ".6rem", padding: ".6rem", background: "#fdecea", color: "#8a1c14", borderRadius: 6, fontSize: ".9rem" }}>{aviso}</div>}

      <textarea rows={2} value={comando} onChange={(e) => setComando(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void interpretar(); } }} placeholder="Fale ou escreva… (Enter envia)" style={{ width: "100%", padding: ".55rem", fontSize: "1rem", boxSizing: "border-box", borderRadius: 6, border: "1px solid #ccc", resize: "vertical" }} />
      <div style={{ marginTop: ".55rem", display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        <button onClick={ditar} disabled={aInterpretar} style={{ ...btn, background: aOuvir ? "#c62828" : "#1b5e20", color: "#fff", border: 0, minWidth: 120 }}>{aOuvir ? "⏹ Parar" : "🎤 Falar"}</button>
        <button onClick={() => interpretar()} disabled={aInterpretar || aOuvir || !comando.trim()} style={{ ...btn, border: "1px solid #b8860b", background: "#fff" }}>{aInterpretar ? "A interpretar…" : "Enviar"}</button>
        {(conversa.length > 0 || comando) && <button onClick={limpar} style={{ ...btn, border: "1px solid #ccc", background: "#fff", marginLeft: "auto" }}>Nova conversa</button>}
      </div>
    </div>
  );

  if (embutido) return painel;

  return (
    <>
      <button aria-label="Assistente de voz" title="Assistente de voz" onClick={() => setAberto(true)} style={{ position: "fixed", right: 24, bottom: 24, zIndex: 900, width: 60, height: 60, borderRadius: "50%", border: 0, cursor: "pointer", background: "#b8860b", color: "#fff", fontSize: 26, boxShadow: "0 6px 18px rgba(0,0,0,.25)" }}>🎤</button>
      {aberto && (
        <div role="presentation" onClick={() => { parar(); setAberto(false); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          {painel}
        </div>
      )}
    </>
  );
}
