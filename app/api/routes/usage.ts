import { createClient } from '@supabase/supabase-js';
import { MailError } from '../mail/server';

/** Service-role access is used only for the global usage counter, never client data. */
export async function reserveMapsUsage(action: 'matrix'|'route'|'geocode', units: number) {
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key) throw new MailError(503,'Controlo de consumo de mapas indisponível.');
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await service.rpc('route_reserve_maps_usage',{p_action:action,p_units:units});
 if(result.error) throw new MailError(503,'Não foi possível verificar o limite de mapas. Nenhum pedido foi enviado.');
 if(result.data!==true) throw new MailError(429,'Limite de utilização dos mapas atingido. Tente mais tarde ou contacte a administração.');
}
