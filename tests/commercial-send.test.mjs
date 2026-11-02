import test from 'node:test';import assert from 'node:assert/strict';import {moduleUrl} from './mail-module.mjs';
const {POST}=await import(await moduleUrl(new URL('../app/api/commercial/send/route.ts',import.meta.url)));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://crm.example.com',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service-test',MICROSOFT_TENANT_ID:'tenant',MICROSOFT_CLIENT_ID:'client',MICROSOFT_CLIENT_SECRET:'secret'});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function mock(t,mode){const calls=[];t.mock.method(globalThis,'fetch',async(input,init={})=>{const url=new URL(String(input));const body=init.body?JSON.parse(typeof init.body==='string'&&init.body.startsWith('{')?init.body:'{}'):{};calls.push({path:url.pathname,body});
 if(url.pathname==='/rest/v1/rpc/has_crm_permission')return response(true);if(url.pathname==='/auth/v1/user')return response({id:'owner',email:'owner@example.com'});
 if(url.pathname==='/rest/v1/profiles')return response({id:'owner',active:true,role:'admin',full_name:'Nome confirmado'});
 if(url.pathname.endsWith('/rpc/has_catalog_orders_beta_access'))return response(true);
 if(url.pathname==='/rest/v1/catalog_orders')return response({id:'doc',workflow_state:mode==='draft'?'draft':'validated',approved_version_id:'version',document_type:'order',order_number:'ENC-TEST',currency:'EUR',total:54,order_date:'2026-10-09'});
 if(url.pathname==='/rest/v1/catalog_document_versions')return response({id:'version',filename:'approved.pdf',pdf_base64:'JVBERi0xLjQ=',snapshot:{client:{trade_name:'Cliente Teste',email:'client@example.com'},manufacturer:{name:'ACHA'},seller:{full_name:'Comercial'},company:{brand_name:'RF'}}});
 if(url.pathname.endsWith('/rpc/commercial_claim_send'))return mode==='duplicate'?response({message:'Envio já iniciado'},409):response({id:'attempt'});
 if(url.hostname==='login.microsoftonline.com')return response({access_token:'token'});
 if(url.pathname.endsWith('/sendMail')){if(mode==='timeout')throw new TypeError('network');if(mode==='denied')return response({error:{message:'denied'}},403);return new Response(null,{status:202});}
 if(url.pathname.endsWith('/rpc/commercial_finish_send'))return response(null);
 throw Error('Unexpected '+url.pathname);
 });return calls;}
const request=(confirm=true)=>new Request('https://crm.local/api/commercial/send',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({id:'doc',confirm,to:['wrong@example.com']})});
test('encomenda usa destinatário fixo, PDF aprovado e confirmação explícita',async t=>{const calls=mock(t);const r=await POST(request());assert.equal(r.status,200);const mail=calls.find(c=>c.path.endsWith('/sendMail')).body.message;assert.deepEqual(mail.toRecipients,[{emailAddress:{address:'comercial@representacoesfreixo.com'}}]);assert.equal(mail.attachments[0].contentBytes,'JVBERi0xLjQ=');assert.match(mail.subject,/NOVA ENCOMENDA/);assert.equal(calls.at(-1).body.result,'accepted');});
test('rascunhos, confirmação ausente e repetição não enviam email',async t=>{for(const mode of ['draft','duplicate','no-confirm']){const calls=mock(t,mode);assert.notEqual((await POST(request(mode!=='no-confirm'))).status,200);assert.ok(!calls.some(c=>c.path.endsWith('/sendMail')));t.mock.restoreAll();}});
test('recusa explícita permite repetir; resultado ambíguo bloqueia repetição',async t=>{for(const mode of ['denied','timeout']){const calls=mock(t,mode);assert.equal((await POST(request())).status,502);assert.equal(calls.at(-1).body.result,mode==='denied'?'failed':'uncertain');assert.equal(calls.filter(c=>c.path.endsWith('/sendMail')).length,1);t.mock.restoreAll();}});
