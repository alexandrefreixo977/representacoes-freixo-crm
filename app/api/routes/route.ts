import { mailSession, json, MailError, mailError } from '../mail/server';
import { GoogleMapsProvider, validateLocation } from '../../route-planner/maps';
import { reserveMapsUsage } from './usage';
import { optimizeWeek, evaluateDay, type Day, type Stop } from '../../route-planner/engine';
import { localDate, localTime, scheduleInstant } from '../../notification-time';
import { Temporal } from '@js-temporal/polyfill';
import {recommendations} from './recommendations';
import {addressKey,currentLocation} from '../../route-planner/location';
import {signLocation,verifyLocation} from './location-proof';

function checked<T extends {error:any;data:any}>(r:T):NonNullable<T['data']> {if(r.error)throw new MailError(400,r.error.message);return r.data as NonNullable<T['data']>;}
const minute=(s:string)=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw new MailError(400,'Hora inválida.');return Number(s.slice(0,2))*60+Number(s.slice(3));};
export async function GET(request:Request) {
 try {
  const {db,user}=await mailSession(request),url=new URL(request.url);
  const profile=checked(await db.from('profiles').select('role').eq('id',user.id).single());
  const owner=profile.role==='admin'?(url.searchParams.get('owner')||user.id):user.id;
  if(url.searchParams.get('kind')==='client-owner')return json(checked(await db.from('clients').select('owner_id').eq('id',url.searchParams.get('id')).single()));
  if(url.searchParams.get('kind')==='context') {
   const client=checked(await db.from('clients').select('id,trade_name,notes,address,city,phone,last_visit_at,next_action,client_manufacturers(manufacturers(name))').eq('id',url.searchParams.get('id')).eq('owner_id',owner).single());
   const contacts=checked(await db.from('client_contacts').select('id,first_name,last_name,email,phone').eq('client_id',client.id).eq('active',true));
   return json({client,contacts,...(await recommendations(db,owner,[client]))[0]});
  }
  if(url.searchParams.get('kind')==='clients') {
   const page=Math.max(0,Math.min(1000,Number(url.searchParams.get('page'))||0));
   let q=db.from('clients').select('id,trade_name,address,postal_code,city,country,region,phone,last_visit_at,priority,priority_label,commercial_potential,visit_frequency_days,route_location',{count:'exact'}).eq('owner_id',owner).is('archived_at',null).order('trade_name').order('id').range(page*100,page*100+99);
   const search=(url.searchParams.get('q')||'').slice(0,100);if(search)q=q.ilike('trade_name',`%${search.replace(/[%_]/g,'')}%`);
   if(url.searchParams.get('id'))q=q.eq('id',url.searchParams.get('id'));
   const r=await q,clients=checked(r),ids=clients.map((c:any)=>c.id);
   if(!ids.length)return json({clients:[],count:r.count});
   return json({clients:await recommendations(db,owner,clients),count:r.count});
  }
  const week=url.searchParams.get('week');if(!week||!/^\d{4}-\d{2}-\d{2}$/.test(week))throw new MailError(400,'Selecione a semana.');
  const [plan,profiles,prefs]=await Promise.all([db.from('route_plans').select('*,route_stops(*,clients(trade_name,address,city,phone,route_location))').eq('owner_id',owner).eq('week_start',week).maybeSingle(),db.from('profiles').select('id,full_name').eq('active',true),db.from('notification_preferences').select('timezone').eq('user_id',owner).maybeSingle()]);
  const timezone=checked(prefs)?.timezone||'Europe/Lisbon';
  const appointments=checked(await db.from('activities').select('id,client_id,start_at,end_at,title,kind,status,clients(trade_name)').eq('assigned_to',owner).gte('start_at',scheduleInstant(week,'00:00',timezone)).lt('start_at',scheduleInstant(Temporal.PlainDate.from(week).add({days:7}).toString(),'00:00',timezone)).not('status','in','(completed,cancelled,canceled,archived)').order('start_at'));
  return json({plan:checked(plan),profiles:checked(profiles),appointments,owner,timezone,mapsReady:!!process.env.GOOGLE_MAPS_SERVER_KEY&&process.env.ROUTE_MAPS_ENABLED==='true',browserKey:process.env.ROUTE_MAPS_ENABLED==='true'?process.env.GOOGLE_MAPS_BROWSER_KEY||null:null});
 }catch(e){return mailError(e);}
}
export async function POST(request:Request) {
 try {
  const {db,user}=await mailSession(request),body=await request.json();
  if(body.action==='create') {
   const profile=checked(await db.from('profiles').select('role').eq('id',user.id).single());
   const owner=profile.role==='admin'?body.owner||user.id:user.id;
   const prefs=checked(await db.from('notification_preferences').select('timezone').eq('user_id',owner).maybeSingle());
   return json({plan:checked(await db.from('route_plans').insert({owner_id:owner,week_start:body.week,timezone:prefs?.timezone||'Europe/Lisbon',settings:{}}).select().single())});
  }
  const plan=checked(await db.from('route_plans').select('*').eq('id',body.planId).single());
  if(body.action==='followup') {
   const stop=checked(await db.from('route_stops').select('activity_id').eq('id',body.stopId).eq('plan_id',plan.id).single());
   if(!stop.activity_id||!String(body.title||'').trim()||!/^\d{4}-\d{2}-\d{2}$/.test(body.date||''))throw new MailError(400,'Escolha uma visita confirmada, indique a próxima ação e a data.');
   Temporal.PlainDate.from(body.date);
   checked(await db.from('activities').update({next_action:String(body.title).trim().slice(0,500),next_action_date:body.date}).eq('id',stop.activity_id).select('id').single());
   return json({ok:true});
  }
  if(body.action==='link') {
   const a=checked(await db.from('activities').select('*').eq('id',body.activityId).eq('assigned_to',plan.owner_id).eq('kind','visit').single());
   if(!a.start_at)throw new MailError(400,'O compromisso não tem hora definida.');
   return json({stop:checked(await db.from('route_stops').insert({plan_id:plan.id,client_id:a.client_id,activity_id:a.id,day:localDate(a.start_at,plan.timezone),starts_at:a.start_at,state:'confirmed',duration_minutes:a.end_at?Math.max(5,Math.ceil((Date.parse(a.end_at)-Date.parse(a.start_at))/60000)):45,reason:a.title||'Visita confirmada'}).select().single())});
  }
  if(body.action==='location') {
   const before=checked(await db.from('clients').select('id,address,postal_code,city,country,route_location').eq('id',body.clientId).eq('owner_id',plan.owner_id).single());
   const proof=body.proof?await verifyLocation(body.proof,process.env.GOOGLE_MAPS_SERVER_KEY||'',`${user.id}:${plan.id}:${before.id}:${addressKey(before)}`):null;
   if(!proof&&(body.latitude===''||body.longitude===''||body.latitude==null||body.longitude==null))throw new MailError(400,'Indique uma localização.');
   const latitude=Number(proof?.location.latitude??body.latitude),longitude=Number(proof?.location.longitude??body.longitude);
   if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||body.confirmed!==true)throw new MailError(400,'Confirme a posição real do cliente.');
   checked(await db.from('route_revisions').insert({plan_id:plan.id,action:'manual_location',snapshot:{client_id:before.id,previous:before.route_location,next:{latitude,longitude}}}));
   const location={latitude,longitude,validated:true,address_key:addressKey(before),source:proof?'google':'manual',...(proof?{place_id:proof.placeId,expires_at:new Date(Date.now()+29*86400000).toISOString()}:{}),validated_by:user.id,validated_at:new Date().toISOString()};
   checked(await db.from('clients').update({route_location:location}).eq('id',before.id).eq('owner_id',plan.owner_id).select('id').single());
   return json({ok:true,location});
  }
  if(body.action==='settings') {
   if(!body.settings||JSON.stringify(body.settings).length>20000)throw new MailError(400,'Configuração inválida.');
   const c=body.settings;validateLocation(c.origin);validateLocation(c.destination);
   for(const name of ['origin','destination']){
    const p=c[name];
    if(p.source==='google'){
     if(p.proof){const v=await verifyLocation(p.proof,process.env.GOOGLE_MAPS_SERVER_KEY||'',`${user.id}:${plan.id}:endpoint`);c[name]={...v.location,address:String(p.address||'').slice(0,500),place_id:v.placeId,source:'google',expires_at:new Date(Date.now()+29*86400000).toISOString()};}
     else if(!['origin','destination'].some(k=>JSON.stringify(plan.settings[k])===JSON.stringify(p)))throw new MailError(400,'Pesquise novamente a morada de partida ou chegada.');
     if(Date.parse(c[name].expires_at)<=Date.now())throw new MailError(400,'Atualize a localização de partida ou chegada através da pesquisa.');
    }
   }
   if(!Array.isArray(c.days)||!c.days.length||c.days.some((d:string)=>d<plan.week_start||d>Temporal.PlainDate.from(plan.week_start).add({days:6}).toString()))throw new MailError(400,'Escolha dias da semana do plano.');
   if(minute(c.start)>=minute(c.end)||minute(c.lunchStart)>minute(c.lunchEnd)||!Number.isInteger(c.maxVisits)||c.maxVisits<1||c.maxVisits>18||!Number.isInteger(c.margin)||c.margin<0||c.margin>120||!(c.costPerKm===''||(Number.isFinite(Number(c.costPerKm))&&Number(c.costPerKm)>=0)))throw new MailError(400,'Horários ou custos inválidos.');
   return json({plan:checked(await db.from('route_plans').update({settings:body.settings}).eq('id',plan.id).eq('revision',body.revision).select().single())});
  }
  if(body.action==='add') {
   const client=checked(await db.from('clients').select('id').eq('id',body.clientId).eq('owner_id',plan.owner_id).is('archived_at',null).single());
   return json({stop:checked(await db.from('route_stops').insert({plan_id:plan.id,client_id:client.id,day:body.day||plan.week_start,reason:String(body.reason||'').slice(0,2000),duration_minutes:body.minutes||45}).select().single())});
  }
  if(body.action==='stop') {
   const keys=['day','position','starts_at','duration_minutes','state','locked','reason','result','contact_id','opportunity_id'];
   const values=Object.fromEntries(keys.filter(k=>body.values?.[k]!==undefined).map(k=>[k,body.values[k]]));
   return json({stop:checked(await db.from('route_stops').update(values).eq('id',body.stopId).eq('plan_id',plan.id).eq('updated_at',body.updatedAt).select().single())});
  }
  if(body.action==='apply') {checked(await db.rpc('route_apply_order',{p_plan:plan.id,p_revision:body.revision,p_stops:body.stops}));return json({ok:true});}
  if(!['geocode','optimize'].includes(body.action))throw new MailError(400,'Ação inválida.');
  if(process.env.ROUTE_MAPS_ENABLED!=='true')throw new MailError(503,'Google Maps aguarda configuração e ativação autorizada.');
  const maps=new GoogleMapsProvider(process.env.GOOGLE_MAPS_SERVER_KEY||'');
  if(body.action==='geocode') {
   const client=body.clientId?checked(await db.from('clients').select('id,address,postal_code,city,country').eq('id',body.clientId).eq('owner_id',plan.owner_id).single()):null;
   if(client&&(!client.address||!client.postal_code||!client.city))throw new MailError(400,'Complete a morada, código postal e localidade na ficha do cliente.');
   const address=client?[client.address,client.postal_code,client.city,client.country||'Portugal'].join(', '):String(body.address||'').trim();
   if(address.length<8||address.length>500)throw new MailError(400,'Indique a rua, número, código postal e localidade.');
   await reserveMapsUsage('geocode',1);
   const candidates=await maps.geocode(address);
   return json({candidates:await Promise.all(candidates.map(async c=>({...c,proof:await signLocation({...c,scope:`${user.id}:${plan.id}:${client?`${client.id}:${addressKey(client)}`:'endpoint'}`},process.env.GOOGLE_MAPS_SERVER_KEY||'')})))});
  }
  const rows=checked(await db.from('route_stops').select('*,clients(id,address,postal_code,city,country,route_location,last_visit_at,visit_frequency_days,priority_label)').eq('plan_id',plan.id).not('state','in','(cancelled,completed,not_done)').order('position'));
  const appointments=checked(await db.from('activities').select('id,start_at,end_at,status').eq('assigned_to',plan.owner_id).gte('start_at',scheduleInstant(plan.week_start,'00:00',plan.timezone)).lt('start_at',scheduleInstant(Temporal.PlainDate.from(plan.week_start).add({days:7}).toString(),'00:00',plan.timezone)).not('status','in','(completed,cancelled,canceled,archived)'));
  if(appointments.some((a:any)=>!rows.some((s:any)=>s.activity_id===a.id)))throw new MailError(409,'Existem compromissos da Agenda ainda não incluídos no plano. A otimização está bloqueada para proteger esses horários.');
  if(rows.some((s:any)=>s.activity_id&&!appointments.some((a:any)=>a.id===s.activity_id&&Date.parse(a.start_at)===Date.parse(s.starts_at))))throw new MailError(409,'Uma visita foi alterada na Agenda. Reveja o plano antes de otimizar.');
  const config=plan.settings;
  if(['origin','destination'].some(k=>config[k]?.expires_at&&Date.parse(config[k].expires_at)<=Date.now()))throw new MailError(400,'Pesquise novamente as moradas de partida e chegada para atualizar a localização.');
  if(!config.origin||!config.destination||!Array.isArray(config.days))throw new MailError(400,'Configure partida, chegada e dias disponíveis.');
  const points=[config.origin,config.destination];
  const scores=await recommendations(db,plan.owner_id,rows.map((s:any)=>s.clients),config.weights);
  const stops:Stop[]=rows.map((s:any)=>{
   const location=s.clients?.route_location;
   if(!currentLocation(s.clients))throw new MailError(400,'Existem clientes sem localização validada e atual. Pesquise novamente a morada.');
   const node=points.push(location)-1;
   return {id:s.id,node,minutes:s.duration_minutes,priority:scores.find(c=>c.id===s.client_id)?.recommendation.score||0,...(s.state==='confirmed'||s.locked?{day:s.day}:{}),...(s.locked?{lockedPosition:s.position}:{}),...(s.state==='confirmed'||s.locked?{fixedMinute:s.starts_at?minute(localTime(s.starts_at,plan.timezone)):undefined}:{})};
  });
  if(points.length>20)throw new MailError(400,'Divida o plano: o limite por cálculo é de 18 visitas para controlar custos.');
  const days:Day[]=config.days.map((date:string)=>({date,start:minute(config.start),end:minute(config.end),lunchStart:minute(config.lunchStart),lunchEnd:minute(config.lunchEnd),maxVisits:Number(config.maxVisits),margin:Number(config.margin),origin:0,destination:1}));
  await reserveMapsUsage('matrix',points.length*points.length);
  const matrix=await maps.matrix(points),result=optimizeWeek(days,stops,matrix);
  const initial=days.map(d=>evaluateDay(d,rows.filter((r:any)=>r.day===d.date).map((r:any)=>stops.find(s=>s.id===r.id)!),matrix));
  const comparable=!result.unassigned.length&&initial.every(d=>d.feasible)&&result.days.every(d=>d.feasible)&&initial.reduce((n,d)=>n+d.stops.length,0)===stops.length;
  const comparison=comparable?{initialMeters:initial.reduce((n,d)=>n+d.meters,0),initialSeconds:initial.reduce((n,d)=>n+d.seconds,0),proposedMeters:result.days.reduce((n,d)=>n+d.meters,0),proposedSeconds:result.days.reduce((n,d)=>n+d.seconds,0)}:null;
  const paths=[];for(const day of result.days){if(day.feasible&&day.stops.length){await reserveMapsUsage('route',1);paths.push({date:day.date,...await maps.route([points[0],...day.stops.map(s=>points[s.node]),points[1]])});}}
  return json({proposal:result,paths,comparison,revision:plan.revision,changes:result.days.flatMap(day=>day.stops.map((s,position)=>({id:s.id,day:day.date,position,starts_at:scheduleInstant(day.date,`${String(Math.floor(s.arrival/60)).padStart(2,'0')}:${String(s.arrival%60).padStart(2,'0')}`,plan.timezone)}))),calculatedAt:new Date().toISOString(),provider:'Google Maps',traffic:'Sem previsão de trânsito'});
 }catch(e){return mailError(e);}
}
