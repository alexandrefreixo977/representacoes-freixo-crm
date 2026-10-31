import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {moduleUrl} from './mail-module.mjs';
import {generateEmailSignature} from '../app/email-signature.ts';
const {POST}=await import(await moduleUrl(new URL('../app/api/send-email/route.ts',import.meta.url)));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://crm.example.com',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',MICROSOFT_TENANT_ID:'tenant',MICROSOFT_CLIENT_ID:'client',MICROSOFT_CLIENT_SECRET:'secret'});
const signature=generateEmailSignature({name:'Owner',email:'owner@example.com',enabled:true},'https://crm.local/email-signature-logo.png');
const signatureVersion=createHash('sha256').update(signature.html).digest('hex');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function mock(t,fail){const calls=[];t.mock.method(globalThis,'fetch',async(input,init={})=>{const url=new URL(String(input));calls.push({url,init});
 if(url.pathname==='/auth/v1/user')return response({id:'owner',email:'owner@example.com'});
 if(url.pathname==='/rest/v1/profiles')return response({id:'owner',active:true,full_name:'Owner',signature_enabled:true});
 if(url.pathname.endsWith('/rpc/has_crm_permission'))return response(true);
 if(url.pathname==='/rest/v1/opportunities')return response(fail==='access'?null:{id:'opp',client_id:'client'},fail==='access'?406:200);
 if(url.pathname==='/rest/v1/catalog_orders'){assert.equal(url.searchParams.get('opportunity_id'),'eq.opp');return response(fail==='proposal'?null:{id:'proposal'},fail==='proposal'?406:200);}
 if(url.hostname==='login.microsoftonline.com')return response({access_token:'token'});
 if(url.pathname.endsWith('/sendMail'))return fail==='send'?response({error:{message:'denied'}},403):new Response(null,{status:202});
 if(url.pathname==='/rest/v1/rpc/opportunity_record_email')return response(fail==='log'?{message:'failed'}:'email',fail==='log'?500:200);
 throw Error('Unexpected request '+url.pathname);
 });return calls;}
const req=(proposalId)=>new Request('https://crm.local/api/send-email',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({opportunityId:'opp',proposalId,to:'test@example.com',subject:'Proposal',unsignedBodyText:'Commercial proposal',bodyHtml:'<p>Commercial proposal</p>',signatureVersion,cc:[],bcc:[],attachments:[]})});
test('opportunity permissions are checked before Graph delivery',async t=>{for(const fail of ['access']){const calls=mock(t,fail);assert.equal((await POST(req())).status,403);assert.ok(!calls.some(c=>c.url.hostname==='graph.microsoft.com'));t.mock.restoreAll();}});
test('failed Graph delivery never records an opportunity email as sent',async t=>{const calls=mock(t,'send');assert.equal((await POST(req())).status,500);assert.ok(!calls.some(c=>c.url.pathname.includes('/rpc/opportunity_record_email')));});
test('accepted delivery records the exact opportunity afterwards',async t=>{const calls=mock(t);assert.equal((await POST(req())).status,200);const last=calls.at(-1);assert.equal(last.url.pathname,'/rest/v1/rpc/opportunity_record_email');const body=JSON.parse(last.init.body);assert.equal(body.oid,'opp');assert.equal(body.proposal,null);assert.deepEqual(body.recipients.to,['test@example.com']);assert.ok(calls.findIndex(c=>c.url.pathname.endsWith('/sendMail'))<calls.length-1);});
test('post-delivery logging failure is a warning, with no automatic resend',async t=>{const calls=mock(t,'log');const res=await POST(req());assert.equal(res.status,200);assert.match((await res.json()).deliveryWarning,/repita o envio/);assert.equal(calls.filter(c=>c.url.pathname.endsWith('/sendMail')).length,1);});

test("propostas exigem circuito com PDF aprovado",async t=>{const calls=mock(t);assert.equal((await POST(req("proposal"))).status,409);assert.ok(!calls.some(c=>c.url.hostname==="graph.microsoft.com"));});

