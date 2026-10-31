import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { moduleUrl } from './mail-module.mjs';
import { generateEmailSignature } from '../app/email-signature.ts';
const {addRecipients,validateRecipients}=await import(await moduleUrl(new URL('../app/mail-recipients.ts',import.meta.url)));
const {replyRecipients}=await import(await moduleUrl(new URL('../app/mail-content.ts',import.meta.url)));
const {POST:reply}=await import(await moduleUrl(new URL('../app/api/mail/reply/route.ts',import.meta.url)));
const {POST:send}=await import(await moduleUrl(new URL('../app/api/send-email/route.ts',import.meta.url)));
const {userSignature}=await import(await moduleUrl(new URL('../app/api/mail/signature.ts',import.meta.url)));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://crm.example.com',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',MICROSOFT_TENANT_ID:'tenant',MICROSOFT_CLIENT_ID:'client',MICROSOFT_CLIENT_SECRET:'secret'});
const signature=generateEmailSignature({name:'Lucia Costa',email:'lcosta@representacoesfreixo.com',enabled:true},'https://crm.local/email-signature-logo.png');
const version=createHash('sha256').update(signature.html).digest('hex');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const req=(body,auth='Bearer test')=>new Request('https://crm.local/api/mail/reply',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
const body={messageId:'original',mode:'reply',comment:'Resposta real <texto>',to:['one@example.com','two@example.com'],cc:['copy@example.com'],bcc:['hidden@example.com'],signatureVersion:version};
function mock(t,failAt=''){
 const calls=[];t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(String(input));calls.push({url,init});
  if(url.pathname==='/rest/v1/rpc/has_crm_permission')return response(true);if(url.pathname==='/auth/v1/user')return response({id:'lucia',email:'lcosta@representacoesfreixo.com'});
  if(url.pathname==='/rest/v1/profiles')return response({id:'lucia',active:true,full_name:'Lucia Costa',signature_enabled:true});
  if(url.hostname==='login.microsoftonline.com')return response({access_token:'token'});
  assert.match(url.pathname,/^\/v1.0\/users\/lcosta%40representacoesfreixo.com\//);
  if(failAt&&url.pathname.endsWith(failAt))return response({error:{message:'private details'}},403);
  if(/\/create(Reply|ReplyAll|Forward)$/.test(url.pathname))return response({id:'draft',body:{contentType:'html',content:'<html><body><hr>Original citado</body></html>'}},201);
  if(url.pathname.endsWith('/send')||url.pathname.endsWith('/sendMail'))return new Response(null,{status:202});
  return response({id:'draft'});
 });return calls;
}
test('chips split Enter/paste delimiters, preserve invalid draft, reject duplicates across fields and validate optional CC/BCC',()=>{
 let lists={to:[],cc:[],bcc:[]};lists=addRecipients(lists,'to','ONE@example.com;two@example.com,three@example.com\nfour@example.com').recipients;
 assert.equal(lists.to.length,4);
 assert.match(addRecipients(lists,'cc','ONE@example.com').error,/não foi repetido/);
 assert.match(addRecipients(lists,'bcc','invalid-email').error,/inválido/);
 assert.deepEqual(addRecipients(lists,'bcc','invalid-email').recipients,lists);
 lists.to=lists.to.filter(x=>x!=='three@example.com');assert.equal(lists.to.length,3);
 assert.deepEqual(validateRecipients(lists),lists);
 assert.throws(()=>validateRecipients({...lists,bcc:['one@example.com']}),/repetido/);
 assert.throws(()=>validateRecipients({...lists,to:[]}),/pelo menos/);
});
test('replyAll excludes main account and aliases, keeps To/CC, never recovers BCC; forwarding starts empty',()=>{
 const party=address=>({emailAddress:{address}});
 const message={from:party('sender@example.com'),toRecipients:[party('lcosta@example.com'),party('alias@example.com'),party('other@example.com')],ccRecipients:[party('copy@example.com'),party('alias@example.com')],bccRecipients:[party('secret@example.com')]};
 assert.deepEqual(replyRecipients(message,'replyAll',['lcosta@example.com','alias@example.com']),{to:['sender@example.com','other@example.com'],cc:['copy@example.com'],bcc:[]});
 assert.deepEqual(replyRecipients(message,'reply','sender@example.com'),{to:[],cc:[],bcc:[]});
 assert.deepEqual(replyRecipients(message,'forward','lcosta@example.com'),{to:[],cc:[],bcc:[]});
});
test('all three modes patch independent recipient arrays and identical signature into threaded draft; BCC never enters HTML, no DB writes',async t=>{
 const calls=mock(t);
 for(const [mode,action] of [['reply','createReply'],['replyAll','createReplyAll'],['forward','createForward']]){
  const result=await reply(req({...body,mode,attachments:[{name:'test.txt',contentType:'text/plain',contentBytes:'YWJj'}]}));assert.equal(result.status,200);
  assert.ok(calls.some(c=>c.url.pathname.endsWith('/original/'+action)));
  const patch=calls.filter(c=>c.init.method==='PATCH').at(-1),payload=JSON.parse(patch.init.body);
  assert.deepEqual(payload.toRecipients.map(p=>p.emailAddress.address),body.to);assert.deepEqual(payload.ccRecipients.map(p=>p.emailAddress.address),body.cc);assert.deepEqual(payload.bccRecipients.map(p=>p.emailAddress.address),body.bcc);
  assert.ok(payload.body.content.includes(signature.html));assert.match(payload.body.content,/Original citado/);assert.match(payload.body.content,/&lt;texto&gt;/);assert.doesNotMatch(payload.body.content,/hidden@example.com/);assert.equal((payload.body.content.match(/data-rf-email-signature/g)||[]).length,1);
  assert.ok(calls.some(c=>c.url.pathname.endsWith('/draft/attachments')));assert.ok(calls.at(-1).url.pathname.endsWith('/draft/send'));
 }
 assert.ok(calls.filter(c=>c.url.pathname.startsWith('/rest')&&!c.url.pathname.endsWith('/rpc/has_crm_permission')).every(c=>(c.init.method??'GET')==='GET'));assert.ok(calls.every(c=>c.init.method!=='DELETE'));
});
test('invalid or duplicate recipients, stale signature, oversized attachments and unauthenticated calls never create/send a draft',async t=>{
 const calls=mock(t);
 for(const extra of [{to:['bad']},{bcc:['ONE@example.com']},{signatureVersion:'stale'},{attachments:[{name:'x',contentBytes:Buffer.alloc(2621441).toString('base64')}]}])assert.ok([400,409,413].includes((await reply(req({...body,...extra}))).status));
 assert.equal((await reply(req(body,''))).status,401);assert.ok(!calls.some(c=>c.url.hostname==='graph.microsoft.com'));
});
test('failed send is not retried, and existing draft is not deleted',async t=>{
 const calls=mock(t,'/send');const result=await reply(req(body));assert.equal(result.status,403);assert.match((await result.json()).error,/Enviados/);assert.equal(calls.filter(c=>c.url.pathname.endsWith('/send')).length,1);assert.ok(calls.every(c=>c.init.method!=='DELETE'));
});
test('new email remains compatible with Office 365, accepts multiple recipients, server signs canonical body',async t=>{
 const calls=mock(t);const result=await send(req({...body,to:body.to,subject:'Test',unsignedBodyText:'Olá',bodyHtml:'tampered',attachments:[]}));assert.equal(result.status,200);const payload=JSON.parse(calls.at(-1).init.body).message;assert.equal(payload.toRecipients.length,2);assert.ok(payload.body.content.includes(signature.html));assert.doesNotMatch(payload.body.content,/tampered|hidden@example.com/);
 const legacy=await send(req({to:'one@example.com',subject:'Existing sender',bodyHtml:'Existing content',attachments:[]}));assert.equal(legacy.status,409);assert.equal(calls.filter(c=>c.url.pathname.endsWith('/sendMail')).length,1);
});
test('blank Lúcia signature uses verified identity with explicit warnings, no generic function/contact data and no write',async()=>{
 const db={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{full_name:'Lucia Costa',signature_enabled:true},error:null})})})})};
 const result=await userSignature(db,{id:'lucia',email:'lcosta@representacoesfreixo.com'},'https://crm.local');assert.equal(result.html,signature.html);assert.ok(result.warnings.some(w=>w.includes('telefone/telemóvel')));assert.doesNotMatch(result.html,/Administrador|Comercial|tel:|Portugal/);
 await assert.rejects(()=>userSignature({from:()=>({select:()=>({eq:()=>({single:async()=>({error:{message:'denied'}})})})})},{id:'x',email:'x@example.com'},'https://crm.local'),/carregar/);
});
