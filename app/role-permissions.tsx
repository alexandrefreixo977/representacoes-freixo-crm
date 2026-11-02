"use client";
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const commercialPermissions = [
 ['clients.edit','Editar dados da ficha de cliente'],
 ['contacts.manage','Adicionar e editar contactos do cliente'],
 ['client_terms.manage','Alterar fabricantes e condições na ficha do cliente'],
 ['workflow.own','Gerir visitas, tarefas, agenda e oportunidades próprias'],
 ['emails.own','Enviar emails e gerir a própria caixa de correio'],
] as const;

export function useCommercialPermissions(isAdmin:boolean,userId?:string){
 const [permissions,setPermissions]=useState<Record<string,boolean>>({});
 useEffect(()=>{
  let active=true;
  setPermissions({});
  const refresh=async()=>{
   if(!userId||isAdmin)return;
   const {data,error}=await supabase.from('role_permissions').select('permission,allowed').eq('role','commercial');
   if(active)setPermissions(error?{}:Object.fromEntries((data??[]).map(r=>[r.permission,r.allowed])));
  };
  void refresh();
  window.addEventListener('focus',refresh);window.addEventListener('crm-permissions-changed',refresh);
  return()=>{active=false;window.removeEventListener('focus',refresh);window.removeEventListener('crm-permissions-changed',refresh);};
 },[userId,isAdmin]);
 return (key:string)=>isAdmin||permissions[key]===true;
}

export default function RolePermissionsEditor(){
 const [values,setValues]=useState<Record<string,boolean>>({});
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;supabase.from('role_permissions').select('permission,allowed').eq('role','commercial').then(({data,error})=>{
  if(!active)return;if(error){setNotice('Não foi possível carregar as permissões.');return;}
  setValues(Object.fromEntries((data??[]).map(r=>[r.permission,r.allowed])));setReady(true);
 });return()=>{active=false};},[]);
 async function save(){
  setBusy(true);setNotice('');
  try{
   const {error}=await supabase.from('role_permissions').upsert(commercialPermissions.map(([permission])=>({role:'commercial',permission,allowed:values[permission]===true})),{onConflict:'role,permission'});
   if(error)throw error;
   window.dispatchEvent(new Event('crm-permissions-changed'));
   setNotice('Permissões guardadas. Aplicam-se a todos os utilizadores com perfil Comercial.');
  }catch{setNotice('Não foi possível guardar. É necessária uma sessão de Administrador ativa.');}finally{setBusy(false);}
 }
 return <article><strong>Comercial</strong><p>Apenas a carteira atribuída ao utilizador. Sem acesso à Administração.</p>
  <p>Estas permissões aplicam-se a todo o perfil Comercial. A leitura da carteira e do histórico mantém-se disponível.</p>
  <div className="commercial-permission-options">{commercialPermissions.map(([key,label])=><label key={key}><input type="checkbox" checked={values[key]===true} disabled={!ready||busy} onChange={e=>setValues({...values,[key]:e.target.checked})}/><span>{label}</span></label>)}</div>
  <p>Sem as três permissões de edição da ficha, o comercial pode consultar os clientes, mas não alterar os seus dados, contactos ou condições.</p>
  <button className="primary" disabled={!ready||busy} onClick={()=>void save()}>{busy?'A guardar…':'Guardar permissões'}</button>
  {notice&&<p role="status">{notice}</p>}
 </article>;
}
