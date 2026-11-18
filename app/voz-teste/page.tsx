"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import VoiceAssistant from "../voice-assistant";

// Página de ensaio do assistente de voz (o mesmo do botão 🎤 do CRM), em ecrã inteiro.
export default function VozTeste() {
  const [session, setSession] = useState<Session | null>(null);
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setPronto(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      {pronto && !session && <p>Inicie sessão no CRM para usar o assistente de voz.</p>}
      {session && <VoiceAssistant session={session} embutido />}
    </main>
  );
}
