import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async(request:Request)=>{
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 if(request.method!=='POST'||request.headers.get('authorization')!==`Bearer ${secret}`)return new Response('Unauthorized',{status:401});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,secret,{auth:{persistSession:false}});
 const fail=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
 try{
  fail(await db.rpc('notification_prepare'));
  const keys=fail(await db.rpc('notification_sender_keys'));
  if(!keys?.notification_vapid_private||!keys?.notification_vapid_public)return Response.json({error:'Push configuration missing'},{status:503});
  webpush.setVapidDetails('mailto:afreixo@representacoesfreixo.com',keys.notification_vapid_public,keys.notification_vapid_private);
  const deliveries=fail(await db.rpc('notification_claim_push'))??[];
  let sent=0,skipped=0,failed=0;
  for(const d of deliveries){
   if(d.status!=='claimed'){skipped++;continue;}
   try{
    const o=fail(await db.from('notification_occurrences').select('*').eq('id',d.occurrence_id).single());
    const i=fail(await db.from('notification_items').select('*').eq('id',o.item_id).eq('source_table',o.source_table).eq('user_id',o.user_id).maybeSingle());
    const expected=fail(await db.from('notification_schedule').select('revision').eq('item_id',o.item_id).eq('source_table',o.source_table).eq('user_id',o.user_id).eq('offset_minutes',o.offset_minutes).eq('scheduled_for',o.scheduled_for).limit(1));
    const p=fail(await db.from('notification_preferences').select('*').eq('user_id',o.user_id).single());
    const s=fail(await db.from('push_subscriptions').select('*').eq('id',d.subscription_id).single());
    const current=Date.now();const clock=new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(current);
    const quiet=p.quiet_enabled&&(p.quiet_start<p.quiet_end?clock>=p.quiet_start.slice(0,5)&&clock<p.quiet_end.slice(0,5):clock>=p.quiet_start.slice(0,5)||clock<p.quiet_end.slice(0,5));
    if(!i||!expected?.length||i.revision!==o.revision||o.status!=='active'||!p.push||!s.active||s.user_id!==o.user_id||!(i.category==='task'?p.tasks_enabled:p.agenda_enabled)||quiet||Date.parse(o.expires_at)<=current){
     fail(await db.from('notification_push_deliveries').update({status:quiet?'quiet':Date.parse(o.expires_at)<=current?'expired':'cancelled'}).eq('id',d.id));skipped++;continue;
    }
    const url=new URL(s.endpoint);
    if(url.protocol!=='https:'||! /^(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/.test(url.hostname)||url.port||url.username||url.password)throw new Error('Invalid push provider');
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:p.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(i.starts_at));
    const date=['year','month','day'].map(k=>parts.find(x=>x.type===k)?.value).join('-');
    const time=new Intl.DateTimeFormat('pt-PT',{timeZone:p.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(i.starts_at));
    const remaining=Math.max(0,Math.ceil((Date.parse(i.starts_at)-current)/60000));
    const href=i.category==='task'?`/tarefas?task=${i.id}`:`/agenda?activity=${i.id}&date=${date}`;
    await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({title:'Representações Freixo CRM',body:`${remaining?`Daqui a ${remaining} minutos`:'Na hora'}\n${i.title}\n${i.client_name??''} · ${time}`,href,tag:`reminder-${o.id}`,userId:o.user_id,expiresAt:o.expires_at}),{TTL:Math.max(1,Math.floor((Date.parse(o.expires_at)-current)/1000)),timeout:8000});
    fail(await db.from('notification_push_deliveries').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',d.id));
    fail(await db.from('push_subscriptions').update({last_used_at:new Date().toISOString()}).eq('id',s.id));sent++;
   }catch(e){const code=Number((e as any).statusCode)||0;await db.from('notification_push_deliveries').update({status:code?'failed':'unknown',error_code:code?String(code):'delivery_uncertain'}).eq('id',d.id);if(code===404||code===410)await db.from('push_subscriptions').update({active:false}).eq('id',d.subscription_id);failed++;}
  }
  return Response.json({sent,skipped,failed});
 }catch{ return Response.json({error:'Reminder dispatch failed'},{status:500}); }
});
