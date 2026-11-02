import type { SupabaseClient } from '@supabase/supabase-js';

export type OpportunityClient = {id:string;trade_name:string;email:string;is_lead?:boolean};

// Use the signed-in client: every page remains subject to the same RLS policies.
export async function loadOpportunityClients(db:SupabaseClient, searchText:string, signal:AbortSignal):Promise<OpportunityClient[]> {
  const search=searchText.replace(/[,()%]/g,' ').trim();
  const rows:OpportunityClient[]=[];
  let offset=0;
  while(!signal.aborted){
    let query=db.from('clients').select('id,trade_name,email,phone,tax_id,is_lead',{count:'exact'})
      .is('archived_at',null).order('trade_name').order('id').range(offset,offset+249).abortSignal(signal);
    if(search)query=query.or(`trade_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,tax_id.ilike.%${search}%`);
    const {data,error,count}=await query;
    if(error)throw new Error(error.message);
    if(!data?.length)break;
    rows.push(...data);offset+=data.length;
    if(count!==null&&offset>=count)break;
  }
  return [...new Map(rows.map(row=>[row.id,row])).values()];
}
