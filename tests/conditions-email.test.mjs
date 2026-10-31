import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {moduleUrl} from './mail-module.mjs';
import {generateEmailSignature} from '../app/email-signature.ts';
const {POST}=await import(await moduleUrl(new URL('../app/api/send-email/route.ts',import.meta.url)));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://crm.example.com',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',MICROSOFT_TENANT_ID:'tenant',MICROSOFT_CLIENT_ID:'client',MICROSOFT_CLIENT_SECRET:'secret'});
const signature=generateEmailSignature({name:'Lucia Costa',email:'lcosta@representacoesfreixo.com',enabled:true},'https://crm.local/email-signature-logo.png');
const signatureVersion=createHash('sha256').update(signature.html).digest('hex');
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const req=()=>new Request('https://crm.local/api/send-email',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({to:'lead@example.com',cc:['copy@example.com'],subject:'Condições ACHA',unsignedBodyText:'Condições aprovadas',bodyHtml:'tampered',signatureVersion,attachments:[],conditions:{clientId:'lead-id',manufacturerId:'brand-id',selected:{items:['base']}}})});
function mock(t,mode){const calls=[];t.mock.method(globalThis,'fetch',async(input,init={})=>{
 const url=new URL(String(input));calls.push({url,init});
 if(url.pathname==='/auth/v1/user')return response({id:'lucia',email:'lcosta@representacoesfreixo.com'});
 if(url.pathname==='/rest/v1/profiles')return response({id:'lucia',active:true,full_name:'Lucia Costa',signature_enabled:true});
 if(url.pathname.endsWith('/rpc/has_crm_permission'))return response(mode!=='permission');
 if(url.pathname==='/rest/v1/clients')return mode==='client'?response({message:'not found'},406):response({id:'lead-id'});
 if(url.pathname==='/rest/v1/manufacturers')return mode==='brand'?response({message:'not found'},406):response({id:'brand-id'});
 if(url.hostname==='login.microsoftonline.com')return response({access_token:'token'});
 if(url.pathname.endsWith('/sendMail'))return mode==='send'?response({error:{message:'denied'}},403):new Response(null,{status:202});
 if(url.pathname.endsWith('/rpc/record_manufacturer_conditions'))return mode==='history'?response({message:'failed'},500):response('saved-email');
 throw Error('Unexpected request '+url.pathname);
 });return calls;}
test('Lead conditions use existing ID, own mailbox, canonical signature and one history transaction',async t=>{
 const calls=mock(t);assert.equal((await POST(req())).status,200);
 const send=calls.find(c=>c.url.pathname.endsWith('/sendMail'));assert.match(send.url.pathname,/lcosta%40representacoesfreixo.com/);
 const message=JSON.parse(send.init.body).message;assert.ok(message.body.content.includes(signature.html));assert.ok(!message.body.content.includes('tampered'));assert.equal(message.toRecipients[0].emailAddress.address,'lead@example.com');
 const history=calls.at(-1);assert.match(history.url.pathname,/record_manufacturer_conditions$/);const payload=JSON.parse(history.init.body);assert.equal(payload.cid,'lead-id');assert.equal(payload.mid,'brand-id');assert.equal(payload.html,message.body.content);assert.equal(calls.filter(c=>c.url.pathname.endsWith('/sendMail')).length,1);
});
for(const mode of ['permission','client','brand'])test(mode+' refusal prevents any Graph call',async t=>{const calls=mock(t,mode);assert.equal((await POST(req())).status,403);assert.ok(!calls.some(c=>c.url.hostname==='graph.microsoft.com'));});
test('Graph refusal never records successful delivery',async t=>{const calls=mock(t,'send');assert.equal((await POST(req())).status,500);assert.ok(!calls.some(c=>c.url.pathname.endsWith('/record_manufacturer_conditions')));});
test('history failure after acceptance warns without retrying the email',async t=>{const calls=mock(t,'history');const res=await POST(req());assert.equal(res.status,200);assert.match((await res.json()).deliveryWarning,/Não repita/);assert.equal(calls.filter(c=>c.url.pathname.endsWith('/sendMail')).length,1);});
