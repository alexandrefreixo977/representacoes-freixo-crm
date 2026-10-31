import type {SupabaseClient} from '@supabase/supabase-js';
import {commercialScore} from '../../route-planner/engine';
export async function recommendations(db:SupabaseClient,owner:string,clients:any[],weights?:Parameters<typeof commercialScore>[1]){
 const ids=clients.map(c=>c.id);if(!ids.length)return [];
 const permitted=await db.rpc('has_catalog_orders_beta_access');
 const [o,t,a,p]=await Promise.all([
  db.from('opportunities').select('id,client_id,title,estimated_value,opportunity_stages(terminal)').in('client_id',ids).eq('seller_id',owner),
  db.from('tasks').select('id,client_id,title,due_at,status').in('client_id',ids).eq('assignee_id',owner).lt('due_at',new Date().toISOString()).not('status','in','(completed,cancelled)'),
  db.from('activities').select('id,client_id,title,start_at,status').in('client_id',ids).eq('assigned_to',owner).eq('kind','task').lt('start_at',new Date().toISOString()).not('status','in','(completed,done,cancelled,canceled)'),
  permitted.data===true?db.from('catalog_orders').select('id,client_id,order_number').in('client_id',ids).eq('seller_id',owner).eq('document_type','proposal').in('workflow_state',['sent','under_review']):Promise.resolve({data:[],error:null})
 ]);
 for(const r of [o,t,a,p])if(r.error)throw new Error('Não foi possível carregar os motivos comerciais das sugestões.');
 return clients.map(c=>{
  const opportunities=(o.data||[]).filter((x:any)=>x.client_id===c.id&&!x.opportunity_stages?.terminal);
  const overdueTasks=[...(t.data||[]),...(a.data||[])].filter(x=>x.client_id===c.id),proposals=(p.data||[]).filter(x=>x.client_id===c.id);
  return {...c,opportunities,overdueTasks,proposals,recommendation:commercialScore({daysSinceVisit:c.last_visit_at?Math.floor((Date.now()-Date.parse(c.last_visit_at))/86400000):undefined,frequencyDays:c.visit_frequency_days??undefined,openOpportunities:opportunities.length,pendingProposals:proposals.length,overdueTasks:overdueTasks.length,strategic:c.priority_label==='A'},weights)};
 });
}
