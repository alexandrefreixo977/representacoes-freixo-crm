"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./supabase";
import ClientDossier from "./client-dossier";
import Manufacturers from "./manufacturers";
import OperationalDashboard from "./operational-dashboard";
import GlobalSearch from "./global-search";
import EmailComposer, { type ComposedEmail, sanitizeSignature } from "./email-composer";
import { generateEmailSignature } from "./email-signature";

type Section = 
  | "Dashboard" 
  | "Agenda" 
  | "Clientes" 
  | "Fabricantes"
  | "Visitas" 
  | "Tarefas" 
  | "Oportunidades" 
  | "Emails" 
  | "Utilizadores"
  | "Relatórios"
  | "Perfil";

const sectionRoutes: Record<Section, string> = {
  Dashboard: "/dashboard", Agenda: "/agenda", Clientes: "/clientes", Fabricantes: "/fabricantes", Visitas: "/visitas",
  Tarefas: "/tarefas", Oportunidades: "/oportunidades", Emails: "/emails",
  Utilizadores: "/administracao", Relatórios: "/relatorios", Perfil: "/perfil",
};

const routeSection = (path: string): Section => path.startsWith("/clientes") ? "Clientes" : path.startsWith("/fabricantes") ? "Fabricantes" :
  (Object.entries(sectionRoutes).find(([,route]) => path === route)?.[0] as Section | undefined) ?? "Dashboard";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "commercial";
  status: "active" | "inactive";
  title: string;
  initials: string;
}

interface ClientRecord {
  id?: string; code: string; name: string; city: string; email: string; phone?: string; taxId?: string;
  assignedUserId: string; owner: string; status: string; last: string; priority: string;
  segment?: string; potential?: string; cecofersa?: boolean; lasRias?: boolean; factorPro?: boolean; bigMat?: boolean; industrialPro?: boolean; validationStatus?: string;
  address?: string; postalCode?: string; region?: string; visitFrequency?: string;
  nextAction?: string; nextActionDate?: string; growthPlan?: string; notes?: string; referenceName?: string;
  contacts?: Array<{ id: string; name: string; jobTitle: string; email: string; phone: string; isPrimary: boolean }>;
  manufacturers?: Array<{ id?: string; relationId?: string; name: string; code: string; discount: number | null; discountStatus: string }>;
}

const initialUsers: User[] = [
  { id: "afreixo", name: "Alexandre Freixo", email: "afreixo@representacoesfreixo.com", role: "admin", status: "active", title: "Administrador", initials: "AF" },
  { id: "tsciullo", name: "Tina Sciullo", email: "comercial@representacoesfreixo.com", role: "admin", status: "active", title: "Administradora", initials: "TS" },
  { id: "lcosta", name: "Lucia Costa", email: "lcosta@representacoesfreixo.com", role: "commercial", status: "active", title: "Comercial", initials: "LC" },
];

const initialClients: ClientRecord[] = [];
type TaskItem = { id: string; title: string; client: string; clientCode: string; assignedUserId: string; time: string; dueAt: string; priority: string; source: "tasks"|"activities"; origin: string; completedAt?: string };
const initialTasks: TaskItem[] = [];
const initialOpportunities: Array<{ id: string; title: string; client: string; clientCode: string; assignedUserId: string; value: string; stage: string; probability: number }> = [];
const initialVisits: Array<{ time: string; name: string; place: string; assignedUserId: string; tag?: string }> = [];
const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
const browserParams = () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);

export default function Home() {
  const [showCover, setShowCover] = useState(true);
  const [section, setActiveSection] = useState<Section>("Dashboard");
  const [routeClientId, setRouteClientId] = useState("");
  const [routeManufacturerId, setRouteManufacturerId] = useState("");
  const [query, setQuery] = useState("");
  const [showQuick, setShowQuick] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  
  // Estado inicial limpo; os registos reais são guardados no Supabase.
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [currentUser, setCurrentUser] = useState<User>(initialUsers[0]);
  const [clients, setClients] = useState(initialClients);
  const [tasks, setTasks] = useState(initialTasks);
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [visits, setVisits] = useState(initialVisits);
  const [session, setSession] = useState<Session | null>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  const applyRoute = () => {
    const path = window.location.pathname;
    setActiveSection(routeSection(path));
    setRouteClientId(path.startsWith("/clientes/") ? decodeURIComponent(path.slice("/clientes/".length)) : "");
    setRouteManufacturerId(path.startsWith("/fabricantes/") ? decodeURIComponent(path.slice("/fabricantes/".length)) : "");
    setShowCover(path === "/");
  };

  const setSection = (next: Section) => {
    const path = sectionRoutes[next];
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setActiveSection(next); setRouteClientId(""); setRouteManufacturerId(""); setShowCover(false);
  };

  const navigate = (next: string, params: Record<string,string> = {}) => {
    const sectionName = next as Section;
    const search = new URLSearchParams(params).toString();
    const path = `${sectionRoutes[sectionName]}${search ? `?${search}` : ""}`;
    window.history.pushState({}, "", path);
    setActiveSection(sectionName); setRouteClientId(""); setRouteManufacturerId(""); setShowCover(false);
  };

  const openClient = (client: ClientRecord) => {
    const id = client.id ?? client.code;
    window.history.pushState({}, "", `/clientes/${encodeURIComponent(id)}`);
    setActiveSection("Clientes"); setRouteClientId(id); setShowCover(false);
  };
  const openManufacturer = (id:string) => { window.history.pushState({},"",`/fabricantes/${encodeURIComponent(id)}`);setActiveSection("Fabricantes");setRouteManufacturerId(id);setShowCover(false); };

  const applySession = (nextSession: Session | null) => {
    setSession(nextSession);
    setProviderToken(nextSession?.provider_token ?? null);
    if (!nextSession) {
      setAccessDenied(false);
      return;
    }
    const account = initialUsers.find((user) => user.email.toLowerCase() === nextSession.user.email?.toLowerCase());
    if (account) {
      setCurrentUser(account);
      setAccessDenied(false);
      const returnPath = window.sessionStorage.getItem("crmMicrosoftReturnPath");
      if (nextSession.provider_token && returnPath) {
        window.sessionStorage.removeItem("crmMicrosoftReturnPath");
        window.history.replaceState({}, "", returnPath);
        applyRoute();
      }
    } else {
      setAccessDenied(true);
    }
  };

  useEffect(() => {
    applyRoute();
    const onPopState = () => applyRoute();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || accessDenied) return;
    supabase.from("clients").select(`
      id,code,trade_name,tax_id,segment,potential,priority_label,commercial_name,status,validation_status,
      visit_frequency,last_visit_at,next_action,next_contact_at,growth_plan,notes,reference_name,is_cecofersa_member,is_las_rias_member,is_factor_pro_member,is_big_mat_member,is_industrial_pro_member,
      email,phone,address,postal_code,city,region,
      client_contacts(id,first_name,last_name,job_title,email,phone,is_primary,active),
      client_manufacturers(id,manufacturer_client_code,agreed_discount,discount_status,manufacturers(id,name))
    `).order("trade_name").then(({ data, error }) => {
      if (error) return;
      setClients((data ?? []).map((row: any) => {
        const owner = initialUsers.find((user) => user.name.toLowerCase().startsWith(String(row.commercial_name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
        return {
          id: row.id, code: row.code, name: row.trade_name, city: row.city ?? "", email: row.email ?? "", phone: row.phone ?? "", taxId: row.tax_id ?? "",
          assignedUserId: owner?.id ?? "", owner: row.commercial_name ?? "Sem responsável", status: row.validation_status === "a_validar" ? "A validar" : row.status === "active" ? "Ativo" : "Potencial",
          last: row.last_visit_at ? new Date(row.last_visit_at).toLocaleDateString("pt-PT") : "—", priority: row.priority_label ?? "—",
          segment: row.segment ?? "", potential: row.potential ?? "", cecofersa: Boolean(row.is_cecofersa_member), lasRias: Boolean(row.is_las_rias_member), factorPro: Boolean(row.is_factor_pro_member), bigMat: Boolean(row.is_big_mat_member), industrialPro: Boolean(row.is_industrial_pro_member), validationStatus: row.validation_status ?? "",
          address: row.address ?? "", postalCode: row.postal_code ?? "", region: row.region ?? "", visitFrequency: row.visit_frequency ?? "",
          nextAction: row.next_action ?? "", nextActionDate: row.next_contact_at?.slice(0,10) ?? "", growthPlan: row.growth_plan ?? "", notes: row.notes ?? "", referenceName: row.reference_name ?? "",
          contacts: (row.client_contacts ?? []).filter((contact: any) => contact.active !== false).map((contact: any) => ({ id: contact.id, name: [contact.first_name, contact.last_name].filter(Boolean).join(" "), jobTitle: contact.job_title ?? "", email: contact.email ?? "", phone: contact.phone ?? "", isPrimary: Boolean(contact.is_primary) })),
          manufacturers: (row.client_manufacturers ?? []).map((relation: any) => ({ id: relation.manufacturers?.id, relationId: relation.id, name: relation.manufacturers?.name ?? "", code: relation.manufacturer_client_code ?? "", discount: relation.agreed_discount, discountStatus: relation.discount_status ?? "" })),
        };
      }));
    });
  }, [session, accessDenied]);

  useEffect(()=>{if(!session||accessDenied)return;const userAlias=(profileName?:string,profileId?:string)=>profileId===session.user.id?currentUser.id:initialUsers.find(u=>profileName&&u.name.toLowerCase().startsWith(profileName.split(" ")[0].toLowerCase()))?.id??profileId??"";Promise.all([
    supabase.from("tasks").select("id,title,status,priority,due_at,completed_at,assignee_id,clients(code,trade_name),profiles!tasks_assignee_id_fkey(full_name)").order("due_at"),
    supabase.from("activities").select("id,title,summary,kind,interaction_type,status,start_at,occurred_at,assigned_to,actor_id,source_module,follow_up_source_id,completed_at,clients(code,trade_name),profiles!activities_assigned_to_fkey(full_name)").in("kind",["task","visit"]).order("start_at"),
    supabase.from("opportunities").select("id,title,estimated_value,probability,seller_id,clients(code,trade_name),opportunity_stages(name,terminal),profiles!opportunities_seller_id_fkey(full_name)").order("updated_at",{ascending:false})
  ]).then(([taskResult,activityResult,opportunityResult])=>{const taskRows=(taskResult.data??[]).map((x:any)=>({id:x.id,title:x.title,client:x.clients?.trade_name??"Cliente",clientCode:x.clients?.code??"",assignedUserId:userAlias(x.profiles?.full_name,x.assignee_id),time:x.due_at?new Date(x.due_at).toLocaleString("pt-PT"):"Sem prazo",dueAt:x.due_at??"",priority:x.priority>=4?"Alta":x.priority<=2?"Baixa":"Média",source:"tasks" as const,origin:"Tarefa manual",completedAt:x.completed_at??undefined,done:["completed","done"].includes(String(x.status).toLowerCase())}));const activityTasks=(activityResult.data??[]).filter((x:any)=>x.kind==="task").map((x:any)=>({id:x.id,title:x.title??x.summary??"Tarefa",client:x.clients?.trade_name??"Cliente",clientCode:x.clients?.code??"",assignedUserId:userAlias(x.profiles?.full_name,x.assigned_to??x.actor_id),time:new Date(x.start_at??x.occurred_at).toLocaleString("pt-PT"),dueAt:x.start_at??x.occurred_at,priority:"Média",source:"activities" as const,origin:x.source_module==="follow_up"?"Follow-up comercial":"Tarefa manual",completedAt:x.completed_at??undefined,done:["completed","done"].includes(String(x.status).toLowerCase())}));const allTasks=[...taskRows,...activityTasks].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);setTasks(allTasks.map(({done,...x})=>x));setCompleted(allTasks.filter(x=>x.done).map(x=>x.id));setVisits((activityResult.data??[]).filter((x:any)=>x.kind==="visit").map((x:any)=>({id:x.id,time:new Date(x.start_at??x.occurred_at).toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"}),date:new Date(x.start_at??x.occurred_at).toISOString().slice(0,10),name:x.clients?.trade_name??"Cliente",place:x.title??x.summary??"Visita",assignedUserId:userAlias(x.profiles?.full_name,x.assigned_to??x.actor_id),tag:x.status==="in_progress"?"Em curso":x.status==="completed"?"Concluída":"Planeada"})));setOpportunities((opportunityResult.data??[]).filter((x:any)=>!x.opportunity_stages?.terminal).map((x:any)=>({id:x.id,title:x.title,client:x.clients?.trade_name??"Cliente",clientCode:x.clients?.code??"",assignedUserId:userAlias(x.profiles?.full_name,x.seller_id),value:new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"}).format(Number(x.estimated_value??0)),stage:x.opportunity_stages?.name??"Lead identificado",probability:x.probability??0})))});},[session,accessDenied,currentUser.id]);

  const signIn = async () => {
    if (session && !accessDenied) {
      setSection("Dashboard");
      return;
    }
    await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email profile openid offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite",
        redirectTo: window.location.origin,
      },
    });
  };

  const logout = async () => {
    setShowLogout(false);
    await supabase.auth.signOut({ scope: "local" });
    setSession(null); setProviderToken(null); setShowCover(true); setActiveSection("Dashboard"); setRouteClientId(""); setRouteManufacturerId("");
    window.history.replaceState({}, "", "/");
  };

  // Filtros de segurança baseados no papel (Role) do Utilizador
  const filteredClients = useMemo(() => {
    const base = currentUser.role === "admin" 
      ? clients 
      : clients.filter(c => c.assignedUserId === currentUser.id);
    return base.filter(c => `${c.name} ${c.code} ${c.taxId} ${c.email} ${c.phone} ${c.city} ${c.manufacturers?.map(m => `${m.name} ${m.code}`).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  }, [clients, currentUser, query]);

  const filteredTasks = useMemo(() => {
    return currentUser.role === "admin" 
      ? tasks 
      : tasks.filter(t => t.assignedUserId === currentUser.id);
  }, [tasks, currentUser]);

  const filteredOpportunities = useMemo(() => {
    return currentUser.role === "admin" 
      ? opportunities 
      : opportunities.filter(o => o.assignedUserId === currentUser.id);
  }, [opportunities, currentUser]);

  const filteredVisits = useMemo(() => {
    return currentUser.role === "admin" 
      ? visits 
      : visits.filter(v => v.assignedUserId === currentUser.id);
  }, [visits, currentUser]);

  const sortClients = (items: ClientRecord[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));
  const handleCreateClient = (newClient: typeof initialClients[0]) => setClients(prev => sortClients([...prev, newClient]));
  const handleUpdateClient = (updatedClient: ClientRecord) => setClients(prev => sortClients(prev.map(client => client.id === updatedClient.id ? updatedClient : client)));

  if (showCover || !session || accessDenied) return <main className="project-cover">
    <div className="cover-image" role="img" aria-label="Representações Freixo CRM, gestão comercial para Portugal e Angola" />
    <div className="cover-shade" />
    <section className="cover-panel">
      <span>PLATAFORMA COMERCIAL</span>
      <h1>O seu dia comercial,<br/>mais simples.</h1>
      <p>Clientes, visitas e oportunidades reunidos num só lugar.</p>
      <button onClick={signIn}>{session && !accessDenied ? "Entrar no CRM" : "Entrar com Microsoft 365"} <b>→</b></button>
      {accessDenied && <p role="alert">Esta conta não tem autorização para aceder ao CRM.</p>}
      <small>Representações Freixo · Portugal</small>
    </section>
  </main>;

  return <main className={`app-shell ${mobileOpen ? "mobile-open" : ""}`}>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
    <aside className="sidebar">
      <button className="brand" onClick={() => window.location.reload()} aria-label="Atualizar aplicação" title="Atualizar aplicação"><div className="brand-mark">RF</div><div><strong>Representações</strong><span>Freixo · CRM</span></div></button>
      
      <nav>
        {[
          { label: "Dashboard", icon: "▦" }, 
          { label: "Agenda", icon: "□" },
          { label: "Clientes", icon: "◎" }, 
          { label: "Fabricantes", icon: "◆" },
          { label: "Visitas", icon: "⌖" },
          { label: "Tarefas", icon: "✓" }, 
          { label: "Oportunidades", icon: "◇" },
          { label: "Emails", icon: "✉" },
        ].map(item => (
          <button 
            key={item.label} 
            className={section === item.label ? "active" : ""} 
            onClick={() => { setSection(item.label as Section); setMobileOpen(false); }}
          >
            <span>{item.icon}</span>
            {item.label}
            {item.label === "Tarefas" && filteredTasks.length > 0 && <b>{filteredTasks.length}</b>}
          </button>
        ))}
      </nav>
      
            <div className="sidebar-bottom">
        <button
          type="button"
          className={section === "Relatórios" ? "active" : ""}
          onClick={() => { setSection("Relatórios"); setMobileOpen(false); }}
        >
          <span>▤</span> Relatórios
        </button>

        {currentUser.role === "admin" && (
          <button
            type="button"
            className={section === "Utilizadores" ? "active" : ""}
            onClick={() => { setSection("Utilizadores"); setMobileOpen(false); }}
          >
            <span>⚙</span> Administração
          </button>
        )}

        <button type="button" className={`profile profile-button ${section === "Perfil" ? "selected" : ""}`} onClick={() => { setSection("Perfil"); setMobileOpen(false); }} aria-label="Abrir área pessoal">
          <div className="profile-row">
            <div className="avatar">{currentUser.initials}</div>
            <div className="profile-copy">
              <strong>{currentUser.name}</strong>
              <span>{currentUser.role === "admin" ? "Administrador" : "Comercial"}</span>
            </div>
            <i aria-hidden="true">›</i>
          </div>
        </button>
      </div>
    </aside>

    <section className="workspace">
      <header>
        <button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMobileOpen(true)}>☰</button>
        <div className="search">
          <span>⌕</span>
          <input 
            aria-label="Pesquisa global" 
            value={query} 
            onChange={e => setQuery(e.target.value)} 
            placeholder="Pesquisar clientes, fabricantes, contactos ou oportunidades..."
          />
          <kbd>⌘ K</kbd>
          <GlobalSearch query={query} clients={clients} onClient={(client)=>{setQuery("");openClient(client as ClientRecord)}} onManufacturer={(id)=>{setQuery("");openManufacturer(id)}} onNavigate={(target,params)=>{setQuery("");navigate(target,params)}}/>
        </div>
        <button className="icon-button" aria-label="Ver tarefas pendentes" onClick={() => setSection("Tarefas")}>◌<em>{filteredTasks.length}</em></button>
        <button className="primary" onClick={() => setShowQuick(!showQuick)}>＋ Novo registo</button>
      </header>

      {showQuick && (
        <div className="quick-menu">
          <strong>Criar novo</strong>
          {([['Cliente','Clientes'],['Visita','Visitas'],['Tarefa','Tarefas'],['Oportunidade','Oportunidades']] as const).map(([label,target]) => (
            <button key={label} onClick={() => { setSection(target); setShowQuick(false); }}>
              ＋ {label}
            </button>
          ))}
        </div>
      )}

      <div className="content">
        {section === "Dashboard" && (
          <OperationalDashboard currentUser={currentUser} session={session} clients={filteredClients} navigate={navigate} openClient={openClient} openManufacturer={openManufacturer}/>
        )} 
        {section === "Clientes" && (
          <Clients 
            rows={filteredClients} 
            query={query} 
            setQuery={setQuery}
            users={users}
            currentUser={currentUser}
            onCreateClient={handleCreateClient}
            onUpdateClient={handleUpdateClient}
            session={session}
            providerToken={providerToken}
            selectedClientId={routeClientId}
            onOpenClient={openClient}
            onCloseClient={() => window.history.back()}
          />
        )} 
        {section === "Agenda" && <Agenda clients={clients} users={users} currentUser={currentUser} session={session} />}
        {section === "Fabricantes" && <Manufacturers clients={clients} currentUser={currentUser} session={session} providerToken={providerToken} selectedId={routeManufacturerId} onOpen={openManufacturer} onClose={() => window.history.back()} />}
        {section === "Visitas" && <Visits clients={filteredClients} visits={filteredVisits} onCreate={(visit) => setVisits(prev => [...prev, visit])} currentUser={currentUser} session={session} />}
        {section === "Tarefas" && <Tasks tasks={filteredTasks} completed={completed} setCompleted={setCompleted} clients={filteredClients} currentUser={currentUser} session={session} onCreate={(task) => setTasks(prev => [...prev, task])} onOpenClient={openClient} />}
        {section === "Oportunidades" && <Pipeline opportunities={filteredOpportunities} clients={filteredClients} currentUser={currentUser} onCreate={(opportunity) => setOpportunities(prev => [...prev, opportunity])} />}
        {section === "Emails" && <Emails clients={filteredClients} session={session} providerToken={providerToken} />}
        {section === "Relatórios" && <Reports clients={filteredClients} visits={filteredVisits} tasks={filteredTasks} opportunities={filteredOpportunities} />}
        {section === "Utilizadores" && currentUser.role === "admin" && (
          <UsersAdmin users={users} setUsers={setUsers} currentUser={currentUser} />
        )}
        {section === "Perfil" && <PersonalArea currentUser={currentUser} session={session} onLogout={() => setShowLogout(true)} />}
      </div>
    </section>
    {showLogout && <div className="confirm-backdrop" role="presentation"><section className="card confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title"><h2 id="logout-title">Terminar sessão</h2><p>Pretende terminar a sessão?</p><div className="form-actions"><button onClick={() => setShowLogout(false)}>Cancelar</button><button className="logout-button" onClick={logout}>Terminar sessão</button></div></section></div>}
  </main>;
}

function PersonalArea({currentUser,session,onLogout}:{currentUser:User;session:Session;onLogout:()=>void}) {
  const lastAccess=session.user.last_sign_in_at ? new Date(session.user.last_sign_in_at).toLocaleString("pt-PT") : "Não disponível";
  const [signature,setSignature]=useState({name:currentUser.name,title:currentUser.title,email:currentUser.email,phone:"",address:"",postalCode:"",locality:"",country:"Portugal",qrPath:"",enabled:true});const [signatureNotice,setSignatureNotice]=useState("");const [savingSignature,setSavingSignature]=useState(false);const [qrFile,setQrFile]=useState<File|null>(null);const [showPreview,setShowPreview]=useState(false);
  useEffect(()=>{supabase.from("profiles").select("signature_name,signature_title,signature_email,signature_phone,signature_address,signature_postal_code,signature_locality,signature_country,signature_qr_path,signature_enabled").eq("id",session.user.id).maybeSingle().then(({data,error})=>{if(error)setSignatureNotice(error.message);else if(data)setSignature({name:data.signature_name||currentUser.name,title:data.signature_title||currentUser.title,email:data.signature_email||currentUser.email,phone:data.signature_phone||"",address:data.signature_address||"",postalCode:data.signature_postal_code||"",locality:data.signature_locality||"",country:data.signature_country||"Portugal",qrPath:data.signature_qr_path||"",enabled:data.signature_enabled!==false})})},[session.user.id,currentUser]);
  const qrUrl=signature.qrPath?supabase.storage.from("email-signatures").getPublicUrl(signature.qrPath).data.publicUrl:"";const preview=generateEmailSignature({...signature,qrUrl},`${typeof window!=="undefined"?window.location.origin:""}/email-signature-logo.png`);
  const chooseQr=(file:File|null)=>{if(!file)return;const allowed=["image/png","image/jpeg","image/webp"];if(!allowed.includes(file.type)||file.size>2*1024*1024){setSignatureNotice("O QR Code deve ser PNG, JPG ou WEBP e ter no máximo 2 MB.");return;}setQrFile(file);setSignatureNotice("");};
  const saveSignature=async()=>{setSavingSignature(true);setSignatureNotice("");let qrPath=signature.qrPath;if(qrFile){const ext=qrFile.name.split(".").pop()?.toLowerCase()==="jpeg"?"jpg":qrFile.name.split(".").pop()?.toLowerCase()||"png";qrPath=`${session.user.id}/qr-code.${ext}`;const uploaded=await supabase.storage.from("email-signatures").upload(qrPath,qrFile,{upsert:true,contentType:qrFile.type});if(uploaded.error){setSavingSignature(false);setSignatureNotice(uploaded.error.message);return;}}const {error}=await supabase.from("profiles").update({signature_name:signature.name.trim()||null,signature_title:signature.title.trim()||null,signature_email:signature.email.trim()||null,signature_phone:signature.phone.trim()||null,signature_address:signature.address.trim()||null,signature_postal_code:signature.postalCode.trim()||null,signature_locality:signature.locality.trim()||null,signature_country:signature.country.trim()||null,signature_qr_path:qrPath||null,signature_enabled:signature.enabled,updated_at:new Date().toISOString()}).eq("id",session.user.id);setSavingSignature(false);if(error)setSignatureNotice(error.message);else{setSignature({...signature,qrPath});setQrFile(null);setSignatureNotice("Assinatura guardada. Será utilizada automaticamente nos novos emails.")}};
  return <><PageTitle eyebrow="CONTA" title="Área pessoal"/><section className="card personal-area"><div className="personal-heading"><div className="avatar personal-avatar">{currentUser.initials}</div><div><h2>{currentUser.name}</h2><p>{currentUser.role === "admin" ? "Administrador" : "Comercial"}</p></div><em className="account-active">Conta ativa</em></div><dl><dt>Nome completo</dt><dd>{currentUser.name}</dd><dt>Email</dt><dd>{currentUser.email}</dd><dt>Perfil / função</dt><dd>{currentUser.title}</dd><dt>Estado da conta</dt><dd>{currentUser.status === "active" ? "Ativa" : "Inativa"}</dd><dt>Último acesso</dt><dd>{lastAccess}</dd></dl><section className="signature-settings"><h3>Assinatura de Email</h3><p>Configure os seus dados. A aplicação gera automaticamente um modelo seguro e compatível com Outlook, Gmail e Apple Mail.</p><div className="form-grid"><label>Nome<input value={signature.name} onChange={e=>setSignature({...signature,name:e.target.value})}/></label><label>Cargo / Função<input value={signature.title} onChange={e=>setSignature({...signature,title:e.target.value})}/></label><label>Email<input type="email" value={signature.email} onChange={e=>setSignature({...signature,email:e.target.value})}/></label><label>Telefone<input value={signature.phone} onChange={e=>setSignature({...signature,phone:e.target.value})}/></label><label className="full">Morada<textarea rows={3} value={signature.address} onChange={e=>setSignature({...signature,address:e.target.value})}/></label><label>Código Postal<input value={signature.postalCode} onChange={e=>setSignature({...signature,postalCode:e.target.value})}/></label><label>Localidade<input value={signature.locality} onChange={e=>setSignature({...signature,locality:e.target.value})}/></label><label>País<input value={signature.country} onChange={e=>setSignature({...signature,country:e.target.value})}/></label><label className="full">QR Code<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>chooseQr(e.target.files?.[0]??null)}/><small>PNG, JPG ou WEBP · máximo 2 MB</small></label><label className="check full"><input type="checkbox" checked={signature.enabled} onChange={e=>setSignature({...signature,enabled:e.target.checked})}/> Ativar assinatura nos emails</label></div><div className="form-actions"><button onClick={()=>setShowPreview(!showPreview)}>{showPreview?"Ocultar pré-visualização":"Pré-visualizar assinatura"}</button><button className="primary" onClick={saveSignature} disabled={savingSignature}>{savingSignature?"A guardar…":"Guardar assinatura"}</button></div>{showPreview&&<><h4>Pré-visualização</h4><div className="signature-preview-box">{preview.html?<div dangerouslySetInnerHTML={{__html:sanitizeSignature(preview.html)}}/>:<p>A assinatura está desativada.</p>}</div></>}{signatureNotice&&<div className="email-notice" role="status">{signatureNotice}</div>}</section><div className="personal-actions"><button className="logout-button" onClick={onLogout}>Terminar sessão</button></div></section></>;
}

function PageTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) { 
  return <div className="page-title">
    <div>
      {eyebrow && <span>{eyebrow}</span>}
      <h1>{title}</h1>
    </div>
    {action}
  </div>;
}

function Stat({label,value,note,accent}:{label:string;value:string;note:string;accent:string}){
  return <div className={`stat ${accent}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function CardHead({title,link,onClick}:{title:string;link:string;onClick?:()=>void}){
  return <div className="card-head"><h2>{title}</h2><button onClick={onClick}>{link} →</button></div>;
}

function VisitRow({time,name,place,tag}:{time:string;name:string;place:string;tag?:string}){
  return <div className="visit"><time>{time}</time><i/><div><strong>{name}</strong><span>{place}</span></div>{tag&&<em>{tag}</em>}</div>;
}

// COMPONENTE: DASHBOARD
function Dashboard({ 
  currentUser,
  setSection, 
  tasks,
  completed, 
  setCompleted,
  opportunities,
  visits
}: { 
  currentUser: User;
  setSection: (s: Section) => void; 
  tasks: typeof initialTasks;
  completed: string[]; 
  setCompleted: (v: string[]) => void;
  opportunities: typeof initialOpportunities;
  visits: typeof initialVisits;
}) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const pendingTasksCount = tasks.filter(t => !completed.includes(t.title)).length;
  
  const pipelineTotal = useMemo(() => {
    const sum = opportunities.reduce((acc, curr) => {
      const val = parseInt(curr.value.replace(/[^0-9]/g, ""), 10) || 0;
      return acc + val;
    }, 0);
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(sum);
  }, [opportunities]);

  return <>
    <PageTitle eyebrow={new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("pt-PT")} title={`Bom dia, ${currentUser.name.split(" ")[0]}`} action={<div className="period"><button className={period === "week" ? "selected" : ""} onClick={() => setPeriod("week")}>Esta semana</button><button className={period === "month" ? "selected" : ""} onClick={() => setPeriod("month")}>Este mês</button></div>}/>
    <p className="subtitle">Aqui está o resumo da atividade comercial {currentUser.role === "admin" ? "da sua equipa" : "pessoal"}.</p>
    
    <div className="stats">
      <Stat label="Visitas hoje" value={String(visits.length)} note={`${visits.filter(v => v.tag === "Em curso").length} em curso`} accent="blue"/>
      <Stat label="Tarefas pendentes" value={String(pendingTasksCount)} note="Foco na conversão" accent="amber"/>
      <Stat label="Pipeline aberto" value={pipelineTotal} note={`${opportunities.length} oportunidades`} accent="green"/>
      <Stat label="Ação necessária" value="0" note="Clientes sem contacto" accent="red"/>
    </div>
    
    <div className="dashboard-grid">
      <section className="card wide">
        <CardHead title={period === "week" ? "Atividade da semana" : "Atividade do mês"} link="Ver relatório" onClick={() => setSection("Relatórios")}/>
        <div className="chart">
          <div className="y-axis"><span>12</span><span>9</span><span>6</span><span>3</span><span>0</span></div>
          {[[5,4],[8,5],[6,7],[9,6],[7,3]].map((v,i)=><div className="bar-day" key={i}><div className="bars"><i style={{height:v[0]*10}}/><i style={{height:v[1]*10}}/></div><span>{["Seg","Ter","Qua","Qui","Sex"][i]}</span></div>)}
        </div>
        <div className="legend"><span><i className="dot blue"/>Visitas</span><span><i className="dot green"/>Tarefas concluídas</span></div>
      </section>
      
      <section className="card">
        <CardHead title="Próximas visitas" link="Ver agenda" onClick={() => setSection("Agenda")}/>
        <div className="visit-list">
          {visits.slice(0, 3).map((v, i) => (
            <VisitRow key={i} time={v.time} name={v.name} place={v.place} tag={v.tag} />
          ))}
          {visits.length === 0 && <p className="empty" style={{ padding: "20px 0" }}>Não tem visitas agendadas.</p>}
        </div>
      </section>
      
      <section className="card wide">
        <CardHead title="Tarefas prioritárias" link="Ver todas" onClick={() => setSection("Tarefas")}/>
        {tasks.slice(0, 3).map(t => (
          <div className={`task-row ${completed.includes(t.title)?"done":""}`} key={t.id}>
            <button aria-label="Concluir tarefa" onClick={() => setCompleted(completed.includes(t.title)?completed.filter(x=>x!==t.title):[...completed,t.title])}>✓</button>
            <div><strong>{t.title}</strong><span>{t.client}</span></div>
            <time>{t.time}</time>
            <em className={t.priority.toLowerCase()}>{t.priority}</em>
          </div>
        ))}
        {tasks.length === 0 && <p className="empty" style={{ padding: "20px 0" }}>Não existem tarefas prioritárias.</p>}
      </section>
      
      <section className="card">
        <CardHead title="Pipeline" link="Ver oportunidades" onClick={() => setSection("Oportunidades")}/>
        <div className="pipeline-total">
          <div><span>Valor Total do Pipeline</span><strong>{pipelineTotal}</strong></div>
          <b>Ativo</b>
        </div>
        {opportunities.slice(0, 3).map(o => (
          <div className="pipeline-row" key={o.id}>
            <div><strong>{o.stage}</strong><span>{o.client}</span></div>
            <b>{o.value}</b>
          </div>
        ))}
        {opportunities.length === 0 && <p className="empty" style={{ padding: "20px 0" }}>Nenhuma oportunidade em aberto.</p>}
      </section>
    </div>
  </>;
}

// COMPONENTE: CLIENTES
function Clients({
  rows,
  query,
  setQuery,
  users,
  currentUser,
  onCreateClient,
  onUpdateClient,
  session,
  providerToken,
  selectedClientId,
  onOpenClient,
  onCloseClient
}: {
  rows: typeof initialClients;
  query: string;
  setQuery: (x: string) => void;
  users: User[];
  currentUser: User;
  onCreateClient: (c: typeof initialClients[0]) => void;
  onUpdateClient: (c: ClientRecord) => void;
  session: Session | null;
  providerToken: string | null;
  selectedClientId: string;
  onOpenClient: (client: ClientRecord) => void;
  onCloseClient: () => void;
}) {
  const routeParams = browserParams();
  const withoutContactDays = Number(routeParams.get("withoutContact")||0);
  const [showAddForm, setShowAddForm] = useState(routeParams.get("new")==="1");
  const [withoutContactIds,setWithoutContactIds]=useState<Set<string>|null>(withoutContactDays?new Set():null);
  const [newClientName, setNewClientName] = useState("");
  const [newClientCity, setNewClientCity] = useState("");
  const [newClientPriority, setNewClientPriority] = useState("Média");
  const [assignedUserId, setAssignedUserId] = useState(currentUser.id);
  const selectedClient = rows.find(client => (client.id ?? client.code) === selectedClientId) ?? null;
  const [manufacturerFilter, setManufacturerFilter] = useState("");
  const [commercialFilter, setCommercialFilter] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("");
  const [potentialFilter, setPotentialFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [associationFilter, setAssociationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(()=>{if(!withoutContactDays)return;supabase.from("activities").select("client_id,occurred_at").then(({data})=>{const cutoff=Date.now()-withoutContactDays*86400000;const latest=new Map<string,number>();(data??[]).forEach((x:any)=>latest.set(x.client_id,Math.max(latest.get(x.client_id)??0,+new Date(x.occurred_at))));setWithoutContactIds(new Set(rows.filter(x=>(latest.get(x.id??"")??0)<cutoff).map(x=>x.id??x.code)))})},[withoutContactDays,rows.length]);

  const unique = (values: Array<string | undefined>) => [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt"));
  const displayRows = rows.filter((client) =>
    (!manufacturerFilter || client.manufacturers?.some((item) => item.name === manufacturerFilter)) &&
    (!commercialFilter || client.owner === commercialFilter) && (!segmentFilter || client.segment === segmentFilter) &&
    (!potentialFilter || client.potential === potentialFilter) && (!priorityFilter || client.priority === priorityFilter) &&
    (!associationFilter || Boolean(client[associationFilter as keyof ClientRecord])) && (!statusFilter || client.status === statusFilter) && (!withoutContactIds||withoutContactIds.has(client.id??client.code))
  ).sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientCity) {
      alert("Por favor preencha todos os campos obrigatórios.");
      return;
    }
    if (!session) { setNotice("A sessão terminou. Volte a entrar com a conta Microsoft 365."); return; }
    const chosenUser = users.find(u => u.id === assignedUserId) || currentUser;
    setSaving(true); setNotice("");
    const ownerProfile = await supabase.from("profiles").select("id").eq("email", chosenUser.email).maybeSingle();
    const priorityMap: Record<string, string> = { Alta: "A", Média: "B", Baixa: "C" };
    const code = `CLI${Date.now().toString().slice(-9)}`;
    const { data, error } = await supabase.from("clients").insert({
      code,
      trade_name: newClientName.trim(),
      city: newClientCity.trim(),
      status: "active",
      priority_label: priorityMap[newClientPriority] ?? "B",
      commercial_name: chosenUser.name.split(" ")[0],
      owner_id: ownerProfile.data?.id ?? session.user.id,
      created_by: session.user.id,
    }).select("id,code,trade_name,city,priority_label,commercial_name").single();
    setSaving(false);
    if (error || !data) { setNotice(`Não foi possível guardar o cliente: ${error?.message ?? "erro desconhecido"}`); return; }
    onCreateClient({ id: data.id, code: data.code, name: data.trade_name, city: data.city ?? "", email: "", assignedUserId: chosenUser.id, owner: data.commercial_name ?? chosenUser.name, status: "Ativo", last: "—", priority: data.priority_label ?? "B" });
    setNewClientName("");
    setNewClientCity("");
    setQuery("");
    setManufacturerFilter(""); setCommercialFilter(""); setSegmentFilter(""); setPotentialFilter(""); setPriorityFilter(""); setAssociationFilter(""); setStatusFilter("");
    setShowAddForm(false);
    setNotice("Cliente guardado com sucesso e adicionado à lista.");
  };

  return <>
    <PageTitle eyebrow="CARTEIRA COMERCIAL" title="Clientes" action={<button className="primary" onClick={() => setShowAddForm(!showAddForm)}>＋ Novo cliente</button>}/>
    {notice && <div className="email-notice" role="status">{notice}</div>}
    
    {showAddForm && (
      <div className="card" style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "16px" }}>Registar Novo Cliente</h2>
        <form onSubmit={handleSubmit} className="form-grid" style={{ display: "grid", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label>Nome do Cliente *
              <input style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} type="text" value={newClientName} onChange={e => setNewClientName(e.target.value)} required placeholder="Ex: Tecno Norte Lda"/>
            </label>
            <label>Cidade *
              <input style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} type="text" value={newClientCity} onChange={e => setNewClientCity(e.target.value)} required placeholder="Ex: Porto"/>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label>Prioridade
              <select style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} value={newClientPriority} onChange={e => setNewClientPriority(e.target.value)}>
                <option>Alta</option>
                <option>Média</option>
                <option>Baixa</option>
              </select>
            </label>
            <label>Responsável Comercial
              <select 
                style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} 
                value={assignedUserId} 
                disabled={currentUser.role !== "admin"}
                onChange={e => setAssignedUserId(e.target.value)}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
            <button type="button" onClick={() => setShowAddForm(false)} style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid #ccc", background: "none" }}>Cancelar</button>
            <button type="submit" className="primary" disabled={saving} style={{ padding: "8px 16px" }}>{saving ? "A guardar…" : "Guardar Cliente"}</button>
          </div>
        </form>
      </div>
    )}

    <div className="toolbar client-filters">
      <div className="search inner">
        <span>⌕</span>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome, código ou localidade do cliente..."/>
      </div>
      <select aria-label="Filtrar por fabricante" value={manufacturerFilter} onChange={e=>setManufacturerFilter(e.target.value)}><option value="">Fabricantes: Todos</option>{unique(rows.flatMap(c=>c.manufacturers?.map(m=>m.name) ?? [])).map(x=><option key={x}>{x}</option>)}</select>
      <select aria-label="Filtrar por comercial" value={commercialFilter} onChange={e=>setCommercialFilter(e.target.value)}><option value="">Comerciais: Todos</option>{unique(rows.map(c=>c.owner)).map(x=><option key={x}>{x}</option>)}</select>
      <select aria-label="Filtrar por segmento" value={segmentFilter} onChange={e=>setSegmentFilter(e.target.value)}><option value="">Segmentos: Todos</option>{unique(rows.map(c=>c.segment)).map(x=><option key={x}>{x}</option>)}</select>
      <select aria-label="Filtrar por potencial" value={potentialFilter} onChange={e=>setPotentialFilter(e.target.value)}><option value="">Potencial: Todos</option>{unique(rows.map(c=>c.potential)).map(x=><option key={x}>{x}</option>)}</select>
      <select aria-label="Filtrar por prioridade" value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)}><option value="">Prioridade: Todas</option>{unique(rows.map(c=>c.priority)).map(x=><option key={x}>{x}</option>)}</select>
      <select aria-label="Filtrar por associação ou grupo" value={associationFilter} onChange={e=>setAssociationFilter(e.target.value)}><option value="">Associação / Grupo: Todos</option><option value="cecofersa">CECOFERSA</option><option value="lasRias">LAS RIAS</option><option value="factorPro">FACTOR PRO / El Sábio</option><option value="bigMat">BIG MAT</option><option value="industrialPro">INDUSTRIAL PRO</option></select>
      <select aria-label="Filtrar por estado" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">Estados: Todos</option>{unique(rows.map(c=>c.status)).map(x=><option key={x}>{x}</option>)}</select>
    </div>

    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Localização</th>
            <th>Responsável</th>
            <th>Último contacto</th>
            <th>Estado</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map(c=><tr key={c.code} onClick={()=>onOpenClient(c)} className="client-row">
            <td><strong>{c.name} <span className="association-badges">{[["cecofersa","CECOFERSA"],["lasRias","LAS RIAS"],["factorPro","FACTOR PRO"],["bigMat","BIG MAT"],["industrialPro","INDUSTRIAL PRO"]].filter(([key])=>Boolean(c[key as keyof ClientRecord])).map(([key,label])=><em className="cecofersa-badge" key={key}>{label}</em>)}</span></strong><span>{c.code}{c.taxId ? ` · ${c.taxId}` : ""}</span></td>
            <td>{c.city}</td>
            <td>{c.owner}</td>
            <td>{c.last}</td>
            <td><em className="status">{c.status}</em></td>
            <td><em className={c.priority.toLowerCase()}>{c.priority}</em></td>
          </tr>)}
        </tbody>
      </table>
      {!displayRows.length && <div className="empty">Nenhum cliente corresponde à pesquisa e aos filtros selecionados.</div>}
    </div>
    {selectedClient && <ClientDossier client={selectedClient} session={session} providerToken={providerToken} isAdmin={currentUser.role==="admin"} onClose={onCloseClient} onUpdate={(client)=>onUpdateClient(client as ClientRecord)}/>}
  </>;
}

// COMPONENTE: AGENDA
type AgendaActivity = { id:string; title:string; description:string; type:string; clientId:string; client:string; contact:string; brand:string; assignedId:string; assigned:string; actorId:string; startAt:string; endAt:string; status:string; source:string; createdBy:string };
function Agenda({ clients, users, currentUser, session }: { clients: ClientRecord[]; users: User[]; currentUser: User; session: Session|null }) {
  const agendaParams=browserParams();const [day, setDay] = useState(() => agendaParams.get("date")?new Date(`${agendaParams.get("date")}T12:00:00`):new Date());
  const [activities,setActivities]=useState<AgendaActivity[]>([]);
  const [showForm,setShowForm]=useState(agendaParams.get("new")==="1");const [selected,setSelected]=useState<AgendaActivity|null>(null);const [editing,setEditing]=useState<AgendaActivity|null>(null);const [notice,setNotice]=useState("");
  const [responsibleFilter,setResponsibleFilter]=useState("");const [typeFilter,setTypeFilter]=useState(agendaParams.get("type")??"");const [brandFilter,setBrandFilter]=useState("");const [clientFilter,setClientFilter]=useState("");
  const [profiles,setProfiles]=useState<Array<{id:string;name:string;email:string}>>([]);
  const [formClientId,setFormClientId]=useState("");
  const moveDay = (amount: number) => setDay(current => { const next = new Date(current); next.setDate(next.getDate() + amount); return next; });
  const loadAgenda=async()=>{if(!session)return;const [{data:profileRows},{data,error}]=await Promise.all([supabase.from("profiles").select("id,full_name,email").eq("active",true),supabase.from("activities").select("id,title,summary,description,interaction_type,client_id,contact_id,manufacturer_id,assigned_to,actor_id,start_at,end_at,occurred_at,status,source_module,clients(trade_name),client_contacts(first_name,last_name),manufacturers(name),assignee:profiles!activities_assigned_to_fkey(full_name),creator:profiles!activities_actor_id_fkey(full_name)").order("start_at")]);if(profileRows)setProfiles(profileRows.map((p:any)=>({id:p.id,name:p.full_name,email:p.email??""})));if(error){setNotice(error.message);return;}setActivities((data??[]).map((row:any)=>({id:row.id,title:row.title??row.summary??"Atividade",description:row.description??"",type:row.interaction_type??row.kind??"Outro",clientId:row.client_id,client:row.clients?.trade_name??"Cliente",contact:[row.client_contacts?.first_name,row.client_contacts?.last_name].filter(Boolean).join(" "),brand:row.manufacturers?.name??"",assignedId:row.assigned_to??row.actor_id,assigned:row.assignee?.full_name??"Responsável",actorId:row.actor_id,startAt:row.start_at??row.occurred_at,endAt:row.end_at??"",status:row.status??"scheduled",source:row.source_module??"client",createdBy:row.creator?.full_name??"Utilizador"})));};
  useEffect(()=>{loadAgenda();if(!session)return;const channel=supabase.channel("global-agenda").on("postgres_changes",{event:"*",schema:"public",table:"activities"},()=>loadAgenda()).subscribe();return()=>{supabase.removeChannel(channel)};},[session]);
  useEffect(()=>{const wanted=agendaParams.get("activity");if(wanted&&activities.length)setSelected(activities.find(x=>x.id===wanted)??null)},[activities.length]);
  useEffect(()=>{if(!showForm)return;const select=document.querySelector<HTMLSelectElement>('.agenda-form select[name="client"]');if(!select)return;const syncClient=()=>setFormClientId(select.value);syncClient();select.addEventListener("change",syncClient);return()=>select.removeEventListener("change",syncClient);},[showForm,editing]);
  const dayKey=(value:Date|string)=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`};
  const visible=activities.filter(item=>dayKey(item.startAt)===dayKey(day)&&(!responsibleFilter||item.assignedId===responsibleFilter)&&(!typeFilter||item.type===typeFilter)&&(!brandFilter||item.brand===brandFilter)&&(!clientFilter||item.clientId===clientFilter));
  const openNew=()=>{setEditing(null);setFormClientId("");setShowForm(true);setSelected(null)};
  const saveActivity=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!session)return;const form=new FormData(event.currentTarget);const clientId=String(form.get("client"));const type=String(form.get("type"));const start=new Date(`${form.get("date")}T${form.get("start")}`).toISOString();const endValue=String(form.get("end")||"");const payload={client_id:clientId,contact_id:String(form.get("contact")||"")||null,manufacturer_id:String(form.get("brand")||"")||null,kind:type==="Visita"?"visit":type==="Chamada"?"call":type==="Reunião"?"meeting":type==="Tarefa"?"task":"note",interaction_type:type,title:String(form.get("title")),summary:String(form.get("title")),description:String(form.get("description")||"")||null,assigned_to:String(form.get("assigned")||session.user.id),actor_id:editing?.actorId??session.user.id,start_at:start,end_at:endValue?new Date(`${form.get("date")}T${endValue}`).toISOString():null,occurred_at:start,status:String(form.get("status")),source_module:editing?.source??"agenda",updated_at:new Date().toISOString()};const response=editing?await supabase.from("activities").update(payload).eq("id",editing.id):await supabase.from("activities").insert(payload);if(response.error){setNotice(response.error.message);return;}setShowForm(false);setEditing(null);setNotice(editing?"Atividade atualizada em todos os módulos.":"Atividade adicionada à agenda global.");await loadAgenda();};
  const removeActivity=async()=>{if(!selected||currentUser.role!=="admin"||!confirm("Apagar esta atividade da agenda e do módulo de origem?"))return;const {error}=await supabase.from("activities").delete().eq("id",selected.id);if(error){setNotice(error.message);return;}setSelected(null);setNotice("Atividade removida.");await loadAgenda();};
  const selectedClient=clients.find(client=>client.id===formClientId);
  return <>
    <PageTitle eyebrow="PLANEAMENTO GLOBAL" title="Agenda da equipa" action={<button className="primary" onClick={openNew}>＋ Agendar atividade</button>}/>
    {notice&&<div className="email-notice" role="status">{notice}</div>}
    <div className="toolbar agenda-filters"><select value={responsibleFilter} onChange={e=>setResponsibleFilter(e.target.value)}><option value="">Responsável: Todos</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="">Tipos: Todos</option>{[...new Set(activities.map(x=>x.type))].map(x=><option key={x}>{x}</option>)}</select><select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}><option value="">Marcas: Todas</option>{[...new Set(activities.map(x=>x.brand).filter(Boolean))].map(x=><option key={x}>{x}</option>)}</select><select value={clientFilter} onChange={e=>setClientFilter(e.target.value)}><option value="">Clientes: Todos</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    {showForm&&<form className="card agenda-form" onSubmit={saveActivity}><h2>{editing?"Editar atividade":"Agendar atividade"}</h2><div className="form-grid"><label>Tipo<select name="type" defaultValue={editing?.type??"Visita"}>{["Visita","Reunião","Chamada","Follow-up","Tarefa","Apresentação","Envio de proposta","Lembrete","Outro"].map(x=><option key={x}>{x}</option>)}</select></label><label>Cliente<select name="client" defaultValue={editing?.clientId} required><option value="">Selecionar…</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Contacto<select name="contact"><option value="">Sem contacto específico</option>{selectedClient?.contacts?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Marca<select name="brand"><option value="">Sem marca específica</option>{selectedClient?.manufacturers?.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Data<input name="date" type="date" defaultValue={editing?dayKey(editing.startAt):dayKey(day)} required/></label><label>Hora início<input name="start" type="time" defaultValue={editing?new Date(editing.startAt).toTimeString().slice(0,5):"09:00"} required/></label><label>Hora fim<input name="end" type="time" defaultValue={editing?.endAt?new Date(editing.endAt).toTimeString().slice(0,5):""}/></label><label>Responsável<select name="assigned" defaultValue={editing?.assignedId??profiles.find(p=>p.email.toLowerCase()===currentUser.email.toLowerCase())?.id??session?.user.id} disabled={currentUser.role!=="admin"}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Estado<select name="status" defaultValue={editing?.status??"scheduled"}><option value="scheduled">Agendada</option><option value="in_progress">Em curso</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option><option value="rescheduled">Reagendada</option></select></label><label className="full">Assunto<input name="title" defaultValue={editing?.title} required/></label><label className="full">Notas<textarea name="description" defaultValue={editing?.description}/></label></div><div className="form-actions"><button type="button" onClick={()=>{setShowForm(false);setEditing(null)}}>Cancelar</button><button className="primary">Guardar atividade</button></div></form>}
    <div className="calendar card">
      <div className="calendar-head">
        <button aria-label="Dia anterior" onClick={() => moveDay(-1)}>←</button>
        <h2>{new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric" }).format(day)}</h2>
        <button onClick={() => setDay(new Date())}>Hoje</button>
        <button aria-label="Dia seguinte" onClick={() => moveDay(1)}>→</button>
      </div>
      {["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"].map((x,i)=><div className="slot" key={x}>
        <time>{x}</time>
        {visible.filter(item=>new Date(item.startAt).getHours()===Number(x.slice(0,2))).map(item=><button className={`event agenda-event type-${item.type.toLowerCase().replace(/[^a-z]+/g,"-")}`} key={item.id} onClick={()=>setSelected(item)}><strong>{new Date(item.startAt).toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"})} | {item.type} | {item.client}</strong><span>{item.assigned}</span></button>)}
      </div>)}
      {!visible.length&&<div className="empty">Não existem atividades para este dia e filtros.</div>}
    </div>
    {selected&&<div className="agenda-detail-backdrop" onClick={()=>setSelected(null)}><article className="card agenda-detail" onClick={e=>e.stopPropagation()}><button className="client-detail-close" onClick={()=>setSelected(null)}>×</button><span>{selected.source.toUpperCase()}</span><h2>{selected.title}</h2><dl><dt>Cliente</dt><dd>{selected.client}</dd><dt>Contacto</dt><dd>{selected.contact||"—"}</dd><dt>Tipo</dt><dd>{selected.type}</dd><dt>Data e hora</dt><dd>{new Date(selected.startAt).toLocaleString("pt-PT")}</dd><dt>Responsável</dt><dd>{selected.assigned}</dd><dt>Marca</dt><dd>{selected.brand||"—"}</dd><dt>Notas</dt><dd>{selected.description||"—"}</dd><dt>Estado</dt><dd>{selected.status}</dd><dt>Criado por</dt><dd>{selected.createdBy}</dd></dl><div className="form-actions">{(currentUser.role==="admin"||selected.assignedId===session?.user.id)&&<button onClick={()=>{setEditing(selected);setShowForm(true);setSelected(null)}}>Editar</button>}{currentUser.role==="admin"&&<button className="danger" onClick={removeActivity}>Apagar</button>}</div></article></div>}
  </>;
}

// COMPONENTE: VISITAS
function Visits({ clients, visits, currentUser, session, onCreate }: { clients: typeof initialClients; visits: typeof initialVisits; currentUser: User; session:Session|null; onCreate: (visit: typeof initialVisits[number]) => void }) {
  const [clientCode, setClientCode] = useState("");
  const [visitType, setVisitType] = useState("Visita comercial");
  const [objective, setObjective] = useState("");
  const [visitDate,setVisitDate]=useState(new Date().toISOString().slice(0,10));
  const [visitTime,setVisitTime]=useState("09:00");
  const [notice, setNotice] = useState("");
  const formId = "visit-form";
  const save = async (started: boolean) => {
    const client = clients.find(c => c.code === clientCode);
    if (!client||!client.id||!session) { setNotice("Selecione primeiro um cliente válido."); return; }
    const startAt=new Date(`${visitDate}T${visitTime}`).toISOString();const {error}=await supabase.from("activities").insert({client_id:client.id,kind:"visit",interaction_type:"Visita",title:visitType,summary:visitType,description:objective||null,actor_id:session.user.id,assigned_to:session.user.id,start_at:startAt,occurred_at:startAt,status:started?"in_progress":"scheduled",source_module:"visits"});if(error){setNotice(error.message);return;}
    onCreate({ time: visitTime, name: client.name, place: client.city || visitType, assignedUserId: currentUser.id, tag: started ? "Em curso" : "Planeada" });
    setNotice(started ? "Visita iniciada e registada." : "Visita guardada como planeada.");
    setObjective("");
  };
  return <>
    <PageTitle eyebrow="ATIVIDADE COMERCIAL" title="Visitas" action={<button className="primary" onClick={() => document.getElementById(formId)?.scrollIntoView({ behavior: "smooth" })}>＋ Planear visita</button>}/>
    <div className="feature-grid">
      {[{t:"Em curso",n:String(visits.filter(v=>v.tag==="Em curso").length),d:"A decorrer agora"},{t:"Planeadas",n:String(visits.filter(v=>v.tag==="Planeada").length),d:"Agendadas"},{t:"Concluídas",n:String(visits.filter(v=>v.tag==="Concluída").length),d:"Relatórios registados"}].map(x=><div className="stat blue" key={x.t}>
        <span>{x.t}</span>
        <strong>{x.n}</strong>
        <small>{x.d}</small>
      </div>)}
    </div>
    <div className="card visit-form" id={formId}>
      <h2>Registo rápido de visita</h2>
      <div className="form-grid">
        <label>Cliente
          <select aria-label="Escolher Cliente" value={clientCode} onChange={e => setClientCode(e.target.value)}>
            <option value="">Selecionar cliente…</option>
            {clients.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label>Tipo
          <select aria-label="Tipo de Visita" value={visitType} onChange={e => setVisitType(e.target.value)}>
            <option>Visita comercial</option>
            <option>Visita técnica</option>
            <option>Demonstração</option>
          </select>
        </label>
        <label className="full">Objetivo
          <textarea value={objective} onChange={e => setObjective(e.target.value)} placeholder="Qual é o objetivo principal desta visita?"/>
        </label>
        <label>Data<input type="date" value={visitDate} onChange={e=>setVisitDate(e.target.value)}/></label><label>Hora<input type="time" value={visitTime} onChange={e=>setVisitTime(e.target.value)}/></label>
      </div>
      <div className="form-actions">
        <button onClick={() => save(false)}>Guardar planeamento</button>
        <button className="primary" onClick={() => save(true)}>Iniciar visita</button>
      </div>
      {notice && <p className="form-hint" role="status">{notice}</p>}
    </div>
  </>;
}

// COMPONENTE: TAREFAS
function Tasks({ 
  tasks, 
  completed, 
  setCompleted,
  clients,
  currentUser,
  session,
  onCreate,
  onOpenClient
}: { 
  tasks: typeof initialTasks; 
  completed: string[]; 
  setCompleted: (v: string[]) => void;
  clients: typeof initialClients;
  currentUser: User;
  session: Session|null;
  onCreate: (task: typeof initialTasks[number]) => void;
  onOpenClient: (client: typeof initialClients[number]) => void;
}) {
  const taskParams=browserParams();const requestedStatus=taskParams.get("status");
  const [tab, setTab] = useState<"todo" | "done" | "all">(requestedStatus==="done"?"done":"todo");
  const [showForm, setShowForm] = useState(taskParams.get("new")==="1");
  const [title, setTitle] = useState("");
  const [clientCode, setClientCode] = useState("");
  const today=new Date().toISOString().slice(0,10);
  const visible = tasks.filter(t => (tab === "all" || (tab === "done" ? completed.includes(t.id) : !completed.includes(t.id))) && (!taskParams.get("task")||t.id===taskParams.get("task")) && (!taskParams.get("date")||t.dueAt.slice(0,10)===taskParams.get("date")) && (requestedStatus!=="overdue"||(!completed.includes(t.id)&&Boolean(t.dueAt)&&t.dueAt.slice(0,10)<today))).sort((a,b)=>{const aDone=completed.includes(a.id),bDone=completed.includes(b.id);if(aDone!==bDone)return aDone?1:-1;return (a.dueAt||"9999").localeCompare(b.dueAt||"9999")});
  const [dueDate,setDueDate]=useState(new Date().toISOString().slice(0,10));const [dueTime,setDueTime]=useState("09:00");
  const createTask = async (event: React.FormEvent) => { event.preventDefault(); const client = clients.find(c => c.code === clientCode); if (!title || !client?.id||!session) return;const startAt=new Date(`${dueDate}T${dueTime}`).toISOString();const {data,error}=await supabase.from("activities").insert({client_id:client.id,kind:"task",interaction_type:"Tarefa",title,summary:title,actor_id:session.user.id,assigned_to:session.user.id,start_at:startAt,occurred_at:startAt,status:"scheduled",source_module:"tasks"}).select("id").single();if(error||!data)return; onCreate({ id: data.id, title, client: client.name, clientCode: client.code, assignedUserId: currentUser.id, time: new Date(startAt).toLocaleString("pt-PT"), dueAt:startAt, priority: "Média", source:"activities", origin:"Tarefa manual" }); setTitle(""); setClientCode(""); setShowForm(false); setTab("todo"); };
  const toggleTask=async(task:TaskItem)=>{if(!session)return;const isDone=completed.includes(task.id);const now=new Date().toISOString();const table=task.source;const payload=table==="activities"?{status:isDone?"scheduled":"completed",completed_at:isDone?null:now,completed_by:isDone?null:session.user.id,updated_at:now}:{status:isDone?"open":"completed",completed_at:isDone?null:now,updated_at:now};const {error}=await supabase.from(table).update(payload).eq("id",task.id);if(error)return;setCompleted(isDone?completed.filter(id=>id!==task.id):[...completed,task.id]);};
  const periodLabel=(task:TaskItem)=>{if(completed.includes(task.id))return "Concluída";const day=task.dueAt?.slice(0,10);if(!day)return "Sem prazo";if(day<today)return "Em atraso";if(day===today)return "Hoje";return "Próxima";};
  return <>
    <PageTitle eyebrow="FOLLOW-UP" title="Tarefas" action={<button className="primary" onClick={() => setShowForm(!showForm)}>＋ Nova tarefa</button>}/>
    {showForm && <form className="card inline-create" onSubmit={createTask}><label>Tarefa<input value={title} onChange={e=>setTitle(e.target.value)} required /></label><label>Cliente<select value={clientCode} onChange={e=>setClientCode(e.target.value)} required><option value="">Selecionar…</option>{clients.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label><label>Data<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required/></label><label>Hora<input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)} required/></label><div className="form-actions"><button type="button" onClick={()=>setShowForm(false)}>Cancelar</button><button className="primary">Guardar tarefa</button></div></form>}
    <div className="tabs">
      <button className={tab === "todo" ? "active" : ""} onClick={()=>setTab("todo")}>A fazer <b>{tasks.filter(t => !completed.includes(t.id)).length}</b></button>
      <button className={tab === "done" ? "active" : ""} onClick={()=>setTab("done")}>Concluídas</button>
      <button className={tab === "all" ? "active" : ""} onClick={()=>setTab("all")}>Todas</button>
    </div>
    <section className="card task-page">
      {visible.map(t=><div className={`task-row ${completed.includes(t.id)?"done":""}`} key={t.id}>
        <button aria-label={completed.includes(t.id)?"Reabrir tarefa":"Concluir tarefa"} onClick={()=>toggleTask(t)}>✓</button>
        <div><strong>{t.title}</strong><button className="task-client-link" onClick={()=>{const client=clients.find(c=>c.code===t.clientCode);if(client)onOpenClient(client)}}>{t.client}</button><small>{t.origin} · {periodLabel(t)}</small></div>
        <time>{t.time}</time>
        <em className={t.priority.toLowerCase()}>{t.priority}</em>
      </div>)}
      {visible.length === 0 && <div className="empty" style={{ padding: "40px" }}>Não existem tarefas nesta lista.</div>}
    </section>
  </>;
}

// COMPONENTE: PIPELINE (OPORTUNIDADES)
function Pipeline({ opportunities, clients, currentUser, onCreate }: { opportunities: typeof initialOpportunities; clients: typeof initialClients; currentUser: User; onCreate: (opportunity: typeof initialOpportunities[number]) => void }) {
  const stages = ["Lead identificado", "Necessidade confirmada", "Proposta enviada", "Negociação"];
  const opportunityParams=browserParams();const [showForm, setShowForm] = useState(opportunityParams.get("new")==="1");
  const [title, setTitle] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [value, setValue] = useState("");
  const createOpportunity = (event: React.FormEvent) => { event.preventDefault(); const client = clients.find(c=>c.code===clientCode); if(!client) return; const amount = Number(value.replace(",", ".")) || 0; onCreate({ id: crypto.randomUUID(), title, client: client.name, clientCode: client.code, assignedUserId: currentUser.id, value: new Intl.NumberFormat("pt-PT", {style:"currency", currency:"EUR"}).format(amount), stage: stages[0], probability: 20 }); setShowForm(false); setTitle(""); setClientCode(""); setValue(""); };
  return <>
    <PageTitle eyebrow="VENDAS" title="Pipeline comercial" action={<button className="primary" onClick={()=>setShowForm(!showForm)}>＋ Nova oportunidade</button>}/>
    {showForm && <form className="card inline-create" onSubmit={createOpportunity}><label>Oportunidade<input value={title} onChange={e=>setTitle(e.target.value)} required /></label><label>Cliente<select value={clientCode} onChange={e=>setClientCode(e.target.value)} required><option value="">Selecionar…</option>{clients.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label><label>Valor estimado (€)<input type="number" min="0" step="0.01" value={value} onChange={e=>setValue(e.target.value)} required /></label><div className="form-actions"><button type="button" onClick={()=>setShowForm(false)}>Cancelar</button><button className="primary">Criar oportunidade</button></div></form>}
    <div className="kanban">
      {stages.map(stage => {
        const stageOpps = opportunities.filter(o => o.stage === stage&&(!opportunityParams.get("stage")||o.stage===opportunityParams.get("stage"))&&(!opportunityParams.get("opportunity")||o.id===opportunityParams.get("opportunity")));
        return (
          <section key={stage}>
            <header><strong>{stage}</strong><span>{stageOpps.length}</span></header>
            {stageOpps.map(o=><article key={o.id}>
              <em>{o.client}</em>
              <h3>{o.title}</h3>
              <strong>{o.value}</strong>
              <div className="progress"><i style={{width:`${o.probability}%`}}/></div>
              <small>{o.probability}% probabilidade</small>
            </article>)}
            {stageOpps.length === 0 && <div className="dropzone">Nenhuma oportunidade</div>}
          </section>
        );
      })}
    </div>
  </>;
}

function Reports({ clients, visits, tasks, opportunities }: { clients: typeof initialClients; visits: typeof initialVisits; tasks: typeof initialTasks; opportunities: typeof initialOpportunities }) {
  const total = opportunities.reduce((sum, item) => sum + (Number(item.value.replace(/[^0-9]/g, "")) || 0), 0);
  return <>
    <PageTitle eyebrow="ANÁLISE COMERCIAL" title="Relatórios" />
    <p className="subtitle">Visão consolidada da atividade comercial atual.</p>
    <div className="stats">
      <Stat label="Clientes" value={String(clients.length)} note="na carteira visível" accent="blue" />
      <Stat label="Visitas" value={String(visits.length)} note="registadas na agenda" accent="green" />
      <Stat label="Tarefas" value={String(tasks.length)} note="atribuídas ao perfil" accent="amber" />
      <Stat label="Pipeline" value={new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(total)} note={`${opportunities.length} oportunidades`} accent="red" />
    </div>
    <section className="card report-card"><h2>Distribuição de clientes por estado</h2>{["Ativo", "Potencial", "A validar"].map(status => { const count = clients.filter(c => c.status === status).length; const width = clients.length ? Math.round(count / clients.length * 100) : 0; return <div className="report-row" key={status}><span>{status}</span><div><i style={{width:`${width}%`}} /></div><strong>{count}</strong></div>; })}</section>
  </>;
}

// COMPONENTE: EMAILS MICROSOFT 365 + HISTÓRICO SUPABASE
type EmailHistory = { id: string; client: string; recipient: string; subject: string; sentAt: string; status: string };

function Emails({ clients, session, providerToken }: { clients: typeof initialClients; session: Session | null; providerToken: string | null }) {
  const [showComposer, setShowComposer] = useState(false);
  const [clientCode, setClientCode] = useState(clients[0]?.code ?? "");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<EmailHistory[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);

  useEffect(()=>{if(!clientCode&&clients[0]){setClientCode(clients[0].code);setRecipient(clients[0].email&&!clients[0].email.endsWith(".example")?clients[0].email:"")}},[clients,clientCode]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("emails")
      .select("id,subject,status,sent_at,clients(trade_name),email_recipients(address,recipient_type)")
      .order("sent_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
        setHistory(rows.map((row) => {
          const client = row.clients as { trade_name?: string } | null;
          const recipients = row.email_recipients as Array<{ address: string; recipient_type: string }> | null;
          return {
            id: String(row.id),
            client: client?.trade_name ?? "Cliente",
            recipient: recipients?.find((item) => item.recipient_type === "to")?.address ?? "",
            subject: String(row.subject ?? ""),
            sentAt: String(row.sent_at ?? ""),
            status: String(row.status ?? ""),
          };
        }));
      });
  }, [session]);

  const connectMicrosoft = async () => {
    setNotice("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email profile openid offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite",
        redirectTo: window.location.origin,
      },
    });
    if (error) setNotice(error.message);
  };

  const chooseClient = (code: string) => {
    setClientCode(code);
    const chosen = clients.find((client) => client.code === code);
    if (chosen?.email && !chosen.email.endsWith(".example")) setRecipient(chosen.email);
  };

  const recordComposedEmail=async(email:ComposedEmail)=>{const selectedClient=clients.find(client=>client.code===clientCode);if(!session||!selectedClient)throw new Error("A sessão terminou.");let {data:clientRecord}=await supabase.from("clients").select("id").eq("code",selectedClient.code).maybeSingle();if(!clientRecord){const created=await supabase.from("clients").insert({code:selectedClient.code,trade_name:selectedClient.name,city:selectedClient.city,email:email.to,status:"active",owner_id:session.user.id,created_by:session.user.id}).select("id").single();if(created.error)throw created.error;clientRecord=created.data}const sentAt=new Date().toISOString();const saved=await supabase.from("emails").insert({client_id:clientRecord.id,sender_id:session.user.id,subject:email.subject,body_html:email.bodyHtml,status:"sent",sent_at:sentAt}).select("id,sent_at").single();if(saved.error)throw saved.error;const recipients=[{email_id:saved.data.id,address:email.to,recipient_type:"to"},...email.cc.map(address=>({email_id:saved.data.id,address,recipient_type:"cc"}))];const rr=await supabase.from("email_recipients").insert(recipients);if(rr.error)throw rr.error;await supabase.from("activities").insert({client_id:clientRecord.id,kind:"email",interaction_type:"Email",actor_id:session.user.id,entity_id:saved.data.id,subject:email.subject,summary:`Email enviado: ${email.subject}`,description:email.attachments.length?`${email.bodyText}\n\nAnexos: ${email.attachments.map(file=>file.name).join(", ")}`:email.bodyText,result:`Para ${email.to}${email.cc.length?` · CC: ${email.cc.join("; ")}`:""}`,status:"sent",occurred_at:sentAt});setHistory(items=>[{id:saved.data.id,client:selectedClient.name,recipient:email.to,subject:email.subject,sentAt,status:"sent"},...items]);setShowComposer(false);setNotice("Email enviado e registado no histórico do cliente.")};

  const sendEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    const selectedClient = clients.find((client) => client.code === clientCode);
    if (!session || !providerToken || !selectedClient) {
      setNotice("Volte a ligar a conta Microsoft 365 antes de enviar.");
      return;
    }
    setSending(true);
    setNotice("");
    try {
      if (attachments.some(file => file.size >= 3 * 1024 * 1024) || attachments.reduce((sum, file) => sum + file.size, 0) >= 3 * 1024 * 1024) throw new Error("Para este envio, cada anexo e o conjunto dos anexos devem ter menos de 3 MB.");
      const graphAttachments = await Promise.all(attachments.map(async file => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: file.name, contentType: file.type || "application/octet-stream", contentBytes: await fileToBase64(file) })));
      const graphResponse = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "HTML", content: body.replace(/\n/g, "<br>") },
            toRecipients: [{ emailAddress: { address: recipient } }],
            attachments: graphAttachments,
          },
          saveToSentItems: true,
        }),
      });
      if (!graphResponse.ok) throw new Error("A Microsoft recusou o envio. Volte a ligar a conta e tente novamente.");

      let { data: clientRecord } = await supabase.from("clients").select("id").eq("code", selectedClient.code).maybeSingle();
      if (!clientRecord) {
        const created = await supabase.from("clients").insert({
          code: selectedClient.code,
          trade_name: selectedClient.name,
          city: selectedClient.city,
          email: recipient,
          status: "active",
          owner_id: session.user.id,
          created_by: session.user.id,
        }).select("id").single();
        if (created.error) throw created.error;
        clientRecord = created.data;
      }

      const savedEmail = await supabase.from("emails").insert({
        client_id: clientRecord.id,
        sender_id: session.user.id,
        subject,
        body_html: body.replace(/\n/g, "<br>"),
        status: "sent",
        sent_at: new Date().toISOString(),
      }).select("id,sent_at").single();
      if (savedEmail.error) throw savedEmail.error;
      await supabase.from("email_recipients").insert({ email_id: savedEmail.data.id, address: recipient, recipient_type: "to" });
      await supabase.from("activities").insert({ client_id: clientRecord.id, kind: "email", interaction_type: "Email", actor_id: session.user.id, entity_id: savedEmail.data.id, subject, summary: `Email enviado: ${subject}`, description: attachments.length ? `${body}\n\nAnexos: ${attachments.map(file => file.name).join(", ")}` : body, result: `Para ${recipient}`, status: "sent" });

      setHistory((items) => [{ id: savedEmail.data.id, client: selectedClient.name, recipient, subject, sentAt: savedEmail.data.sent_at, status: "sent" }, ...items]);
      setSubject("");
      setBody("");
      setAttachments([]);
      setShowComposer(false);
      setNotice("Email enviado e registado no histórico do cliente.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível enviar o email.");
    } finally {
      setSending(false);
    }
  };

  return <>
    <PageTitle eyebrow="MICROSOFT 365" title="Emails" action={<button className="primary" onClick={() => session ? setShowComposer(true) : connectMicrosoft()}>✉ {session ? "Novo email" : "Ligar Microsoft 365"}</button>}/>
    {notice && <div className="email-notice" role="status">{notice}</div>}
    <div className="email-layout">
      <section className="card integration">
        <div className="ms-logo">M</div>
        <div>
          <h2>{session ? "Conta Microsoft 365 ligada" : "Ligue a sua conta Microsoft 365"}</h2>
          <p>{session ? `Sessão ativa: ${session.user.email ?? "utilizador Microsoft"}` : "Envie emails profissionais e associe-os automaticamente à timeline do cliente."}</p>
          <span className={session ? "connected" : ""}>{session ? "Ligação segura ativa" : "É necessária uma conta da organização"}</span>
        </div>
        {session ? <button onClick={() => supabase.auth.signOut()}>Desligar</button> : <button onClick={connectMicrosoft}>Ligar conta Microsoft</button>}
      </section>
      <section className="card">
        <CardHead title="Emails recentes" link={`${history.length} registados`}/>
        {history.length ? <div className="email-history">{history.map(item => <article key={item.id}><div><strong>{item.subject}</strong><span>{item.client} · {item.recipient}</span></div><time>{new Date(item.sentAt).toLocaleString("pt-PT")}</time><em>Enviado</em></article>)}</div> : <div className="empty email-empty"><div>✉</div><strong>Ainda não existem emails enviados</strong><span>Os emails enviados aparecerão aqui e na ficha do cliente correspondente.</span></div>}
      </section>
    </div>
    {showComposer && session && <section className="card email-composer"><h2>Novo email</h2><label>Cliente<select value={clientCode} onChange={(e)=>chooseClient(e.target.value)} required>{clients.map(client=><option key={client.code} value={client.code}>{client.name}</option>)}</select></label><EmailComposer providerToken={providerToken} userId={session.user.id} initialTo={recipient} toOptions={clients.flatMap(client=>[{label:client.name,email:client.email},...(client.contacts??[]).map(contact=>({label:`${contact.name} — ${client.name}`,email:contact.email}))])} onCancel={()=>setShowComposer(false)} onSent={recordComposedEmail}/></section>}
  </>;
}

// NOVO COMPONENTE: ADMINISTRAÇÃO DE UTILIZADORES
function UsersAdmin({ 
  users, 
  setUsers,
  currentUser 
}: { 
  users: User[]; 
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "commercial">("commercial");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  const resetForm = () => {
    setName("");
    setEmail("");
    setRole("commercial");
    setStatus("active");
    setEditingUserId(null);
  };

  const handleCreateOrUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) {
      alert("Por favor, preencha todos os campos obrigatórios.");
      return;
    }

    if (editingUserId) {
      // Regra de segurança: Não permitir desativar ou retirar o perfil de Admin do último Administrador ativo
      if (editingUserId === currentUser.id && (status === "inactive" || role === "commercial")) {
        alert("Erro de Segurança: Não pode desativar ou mudar o perfil do seu próprio utilizador enquanto estiver logado.");
        return;
      }

      setUsers(prev => prev.map(u => u.id === editingUserId ? {
        ...u,
        name,
        email,
        role,
        status,
        title: role === "admin" ? "Administrador" : "Comercial",
        initials: name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
      } : u));
    } else {
      const newUser: User = {
        id: `u${users.length + 1}`,
        name,
        email,
        role,
        status,
        title: role === "admin" ? "Administrador" : "Comercial",
        initials: name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
      };
      setUsers(prev => [...prev, newUser]);
    }

    resetForm();
    setShowAddForm(false);
  };

  const startEdit = (user: User) => {
    setEditingUserId(user.id);
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setStatus(user.status);
    setShowAddForm(true);
  };

  const toggleUserStatus = (user: User) => {
    // Regra de segurança: Impedir desativar o último administrador ativo
    const activeAdmins = users.filter(u => u.role === "admin" && u.status === "active");
    if (user.role === "admin" && user.status === "active" && activeAdmins.length <= 1) {
      alert("Erro de Segurança: Tem de manter pelo menos um Administrador Ativo no sistema.");
      return;
    }

    setUsers(prev => prev.map(u => u.id === user.id ? {
      ...u,
      status: u.status === "active" ? "inactive" : "active"
    } : u));
  };

  const removeUserAccess = (id: string) => {
    const userToRemove = users.find(u => u.id === id);
    if (!userToRemove) return;
    if (userToRemove.id === currentUser.id) {
      alert("Não pode remover o acesso do utilizador com sessão ativa.");
      return;
    }
    const activeAdmins = users.filter(u => u.role === "admin" && u.status === "active");
    if (userToRemove.role === "admin" && userToRemove.status === "active" && activeAdmins.length <= 1) {
      alert("Tem de manter pelo menos um Administrador ativo.");
      return;
    }
    if (confirm(`Remover o acesso de "${userToRemove.name}"? O histórico será preservado.`)) {
      setUsers(prev => prev.map(u => u.id === id ? { ...u, status: "inactive" } : u));
    }
  };

  return <>
    <PageTitle eyebrow="SEGURANÇA E EQUIPA" title="Gestão de Utilizadores" action={
      <button className="primary" onClick={() => { resetForm(); setShowAddForm(!showAddForm); }}>
        {showAddForm ? "Fechar Formulário" : "＋ Novo Utilizador"}
      </button>
    }/>

    {showAddForm && (
      <div className="card" style={{ marginBottom: "24px" }}>
        <h2>{editingUserId ? "Editar Utilizador" : "Criar Novo Utilizador"}</h2>
        <form onSubmit={handleCreateOrUpdate} className="form-grid" style={{ display: "grid", gap: "16px", marginTop: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label>Nome Completo *
              <input style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Ex: Maria Ramos"/>
            </label>
            <label>Email Corporativo *
              <input style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Ex: utilizador@representacoesfreixo.com"/>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label>Perfil (Permissões)
              <select style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} value={role} onChange={e => setRole(e.target.value as "admin" | "commercial")}>
                <option value="commercial">Comercial (Apenas dados próprios)</option>
                <option value="admin">Administrador (Acesso total)</option>
              </select>
            </label>
            <label>Estado
              <select style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "4px", border: "1px solid #ccc" }} value={status} onChange={e => setStatus(e.target.value as "active" | "inactive")}>
                <option value="active">Ativo (Acesso autorizado)</option>
                <option value="inactive">Inativo (Acesso bloqueado)</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
            <button type="button" onClick={() => { resetForm(); setShowAddForm(false); }} style={{ padding: "8px 16px", borderRadius: "4px", border: "1px solid #ccc", background: "none" }}>Cancelar</button>
            <button type="submit" className="primary" style={{ padding: "8px 16px" }}>
              {editingUserId ? "Atualizar Utilizador" : "Criar Utilizador"}
            </button>
          </div>
        </form>
      </div>
    )}

    <section className="permissions-card" aria-labelledby="permissions-title">
      <div>
        <span>PERFIS DEFINIDOS</span>
        <h2 id="permissions-title">Permissões por perfil</h2>
        <p>As permissões são aplicadas pelo perfil atribuído e validadas também no backend.</p>
      </div>
      <div className="permissions-grid">
        <article>
          <strong>Administrador</strong>
          <p>Acesso integral ao CRM, utilizadores, equipa, configurações, auditoria e todos os registos comerciais.</p>
          <ul><li>Gerir utilizadores e permissões</li><li>Consultar e editar todos os clientes</li><li>Gerir toda a atividade comercial</li><li>Consultar administração e auditoria</li></ul>
        </article>
        <article>
          <strong>Comercial</strong>
          <p>Acesso ao fluxo de trabalho comercial que lhe está atribuído, sem acesso à administração.</p>
          <ul><li>Consultar e gerir os seus clientes</li><li>Gerir visitas, tarefas e agenda próprias</li><li>Gerir as suas oportunidades e emails</li><li>Sem acesso à gestão de utilizadores</li></ul>
        </article>
      </div>
    </section>

    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Email</th>
            <th>Perfil</th>
            <th>Estado</th>
            <th style={{ textAlign: "right" }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div className="avatar" style={{ margin: 0, width: "32px", height: "32px", fontSize: "12px" }}>{u.initials}</div>
                  <strong>{u.name}</strong>
                </div>
              </td>
              <td>{u.email}</td>
              <td>
                <span style={{ 
                  padding: "4px 8px", 
                  borderRadius: "12px", 
                  fontSize: "11px", 
                  fontWeight: "bold",
                  background: u.role === "admin" ? "#e0f2fe" : "#f3f4f6", 
                  color: u.role === "admin" ? "#0369a1" : "#374151" 
                }}>
                  {u.role === "admin" ? "Administrador" : "Comercial"}
                </span>
              </td>
              <td>
                <span style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: "4px",
                  color: u.status === "active" ? "#16a34a" : "#dc2626",
                  fontWeight: "bold"
                }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: u.status === "active" ? "#16a34a" : "#dc2626" }} />
                  {u.status === "active" ? "Ativo" : "Inativo"}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                <div style={{ display: "inline-flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button 
                    onClick={() => startEdit(u)} 
                    style={{ padding: "4px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #ccc", background: "white", cursor: "pointer" }}
                  >
                    Editar
                  </button>
                  <button 
                    onClick={() => toggleUserStatus(u)} 
                    style={{ 
                      padding: "4px 8px", 
                      fontSize: "12px", 
                      borderRadius: "4px", 
                      border: "none", 
                      background: u.status === "active" ? "#fee2e2" : "#dcfce7", 
                      color: u.status === "active" ? "#b91c1c" : "#15803d",
                      cursor: "pointer" 
                    }}
                  >
                    {u.status === "active" ? "Desativar" : "Ativar"}
                  </button>
                  <button 
                    onClick={() => removeUserAccess(u.id)}
                    disabled={u.status === "inactive" || u.id === currentUser.id}
                    style={{ padding: "4px 8px", fontSize: "12px", borderRadius: "4px", border: "none", background: "#f3f4f6", color: "#b91c1c", cursor: "pointer" }}
                  >
                    Remover acesso
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>;
}

