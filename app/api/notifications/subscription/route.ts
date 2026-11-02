import { mailSession, mailError, json, MailError } from '../../mail/server';
export async function GET(request:Request){try{const {db}=await mailSession(request);const r=await db.rpc('notification_public_key');if(r.error)throw r.error;if(!r.data)throw new MailError(503,'As notificações push ainda estão a ser configuradas.');return json({publicKey:r.data});}catch(e){return mailError(e);}}
export async function POST(request:Request){try{
 const {db,user}=await mailSession(request);const b=await request.json();
 const endpoint=String(b.subscription?.endpoint??b.endpoint??'');
 if(!/^https:\/\/(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//.test(endpoint))throw new MailError(400,'Serviço push não suportado.');
 const result=b.disable?await db.from('push_subscriptions').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',user.id).eq('endpoint',endpoint):await db.from('push_subscriptions').upsert({user_id:user.id,endpoint,p256dh:b.subscription.keys?.p256dh,auth:b.subscription.keys?.auth,device_info:request.headers.get('user-agent')?.slice(0,300),active:true,updated_at:new Date().toISOString()},{onConflict:'endpoint'});
 if(result.error)throw new MailError(400,'Não foi possível registar este dispositivo. Termine a sessão anterior e tente novamente.');return json({ok:true});
}catch(e){return mailError(e);}}
