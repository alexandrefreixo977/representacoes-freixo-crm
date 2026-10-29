import { useState, type FormEvent } from "react";
import { api } from "../data";
import { go, useApp } from "../state";

export function LoginPage() {
  const { route, session, refreshSession } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = route.params.get("voltar") ?? "";
  const linkError = route.params.get("erro") === "ligacao";

  if (session) {
    return (
      <div className="panel narrow">
        <h1>A sua conta</h1>
        <p>
          Sessão iniciada como <strong>{session.email}</strong>
          {session.client ? <> · {session.client.name}</> : session.role === "admin" ? " · Gestão Freixo" : ""}
        </p>
        <div className="row">
          {session.role === "admin" && <button className="btn primary" onClick={() => go("gestao")}>Área de gestão</button>}
          <button className="btn ghost" onClick={() => go("encomendas")}>As minhas encomendas</button>
          <button className="btn ghost" onClick={async () => { await api.signOut(); await refreshSession(); go(""); }}>Terminar sessão</button>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.signIn(email, password);
      await refreshSession();
      go(back || (s.role === "admin" ? "gestao" : ""));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel narrow" onSubmit={submit}>
      <h1>Área de clientes</h1>
      <p className="muted">Entre para ver os seus preços e fazer encomendas.</p>
      {api.mode === "demo" && (
        <div className="demo-box">
          <strong>Modo demonstração</strong>
          <span>Cliente: cliente@demo.pt / demo</span>
          <span>Gestão Freixo: gestao@demo.pt / demo</span>
        </div>
      )}
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Palavra-passe
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {linkError && !error && (
        <p className="error">A ligação do email já expirou ou já foi usada. Escreva o seu email e use "Esqueci-me da palavra-passe" para receber outra.</p>
      )}
      {error && <p className="error">{error}</p>}
      {info && <p className="ok">{info}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? "A entrar…" : "Entrar"}</button>
      <div className="row between">
        <button
          type="button"
          className="link"
          onClick={async () => {
            if (!email) return setError("Escreva primeiro o seu email.");
            await api.resetPassword(email).catch(() => undefined);
            setInfo("Se o email tiver conta, vai receber uma ligação para definir nova palavra-passe.");
          }}
        >
          Esqueci-me da palavra-passe
        </button>
        <a className="link" href="#/pedir-acesso">Ainda não tem conta?</a>
      </div>
    </form>
  );
}

export function AccessRequestPage() {
  const [form, setForm] = useState({ company: "", nif: "", name: "", email: "", phone: "", message: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (sent) {
    return (
      <div className="panel narrow">
        <h1>Pedido enviado</h1>
        <p>Obrigado. A equipa da Representações Freixo vai analisar o pedido e enviar-lhe os dados de acesso por email.</p>
        <button className="btn ghost" onClick={() => go("")}>Voltar ao catálogo</button>
      </div>
    );
  }

  return (
    <form
      className="panel narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.requestAccess(form);
          setSent(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h1>Pedir acesso</h1>
      <p className="muted">Área reservada a revendedores profissionais. Depois de validado, recebe acesso aos preços e às encomendas online.</p>
      <label>Empresa<input required value={form.company} onChange={set("company")} /></label>
      <label>NIF<input value={form.nif} onChange={set("nif")} inputMode="numeric" /></label>
      <label>Nome<input required value={form.name} onChange={set("name")} /></label>
      <label>Email<input type="email" required value={form.email} onChange={set("email")} /></label>
      <label>Telefone<input type="tel" value={form.phone} onChange={set("phone")} /></label>
      <label>Mensagem<textarea value={form.message} onChange={set("message")} placeholder="Zona, tipo de loja, marcas que lhe interessam…" /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block">Enviar pedido</button>
    </form>
  );
}

export function SetPasswordPage() {
  const { session, refreshSession } = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <div className="panel narrow">
        <h1>Definir palavra-passe</h1>
        <p className="muted">A validar a ligação do email…</p>
        <p className="hint">Se esta mensagem não desaparecer, a ligação pode ter expirado. <a href="#/entrar">Peça uma nova</a>.</p>
      </div>
    );
  }

  return (
    <form
      className="panel narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) return setError("A palavra-passe tem de ter pelo menos 8 caracteres.");
        if (password !== confirm) return setError("As duas palavras-passe não são iguais.");
        setBusy(true);
        try {
          await api.setPassword(password);
          await refreshSession();
          go(session.role === "admin" ? "gestao" : "");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>Definir palavra-passe</h1>
      <p className="muted">Conta: <strong>{session.email}</strong>. Escolha a palavra-passe com que vai entrar daqui em diante.</p>
      <label>
        Nova palavra-passe
        <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Repetir palavra-passe
        <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? "A guardar…" : "Guardar e entrar"}</button>
    </form>
  );
}
