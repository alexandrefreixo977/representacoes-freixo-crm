import assert from "node:assert/strict";
import test from "node:test";
import { moduleUrl } from "./mail-module.mjs";
const {POST}=await import(await moduleUrl(new URL("../app/api/mail/sync/route.ts",import.meta.url)));
const {GET:list}=await import(await moduleUrl(new URL("../app/api/mail/list/route.ts",import.meta.url)));
const {GET:message}=await import(await moduleUrl(new URL("../app/api/mail/message/route.ts",import.meta.url)));
const {GET:entity}=await import(await moduleUrl(new URL("../app/api/mail/by-entity/route.ts",import.meta.url)));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:"https://crm.example.com",NEXT_PUBLIC_SUPABASE_ANON_KEY:"anon",MICROSOFT_TENANT_ID:"tenant",MICROSOFT_CLIENT_ID:"client",MICROSOFT_CLIENT_SECRET:"secret"});
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
const request=(path,auth="Bearer test-jwt")=>new Request("https://crm.local/api/mail/"+path,{headers:{authorization:auth}});
function mock(t,opts={}){
 const calls=[];
 t.mock.method(globalThis,"fetch",async(input,init)=>{
  const url=new URL(String(input)); calls.push({url,init});
  if(url.pathname==="/auth/v1/user")return opts.invalid?reply({message:"Invalid JWT"},401):reply({id:"owner",email:"owner@example.com"});
  if(url.pathname==="/rest/v1/profiles")return reply({id:"owner",active:!opts.inactive});
  if(url.hostname==="login.microsoftonline.com")return reply({access_token:"app-token"});
  if(url.hostname==="graph.microsoft.com"){
   if(opts.graphError)return reply({error:{}},403);
   assert.match(url.pathname,/\/users\/owner%40example.com\//);
   assert.equal(init.cache,"no-store");assert.equal(init.method??"GET","GET");
   if(!url.pathname.endsWith("/messages"))return reply({body:{contentType:"html",content:"<p>Completo</p>"},isRead:false});
   if(opts.pages){const second=url.searchParams.has("$skiptoken");return reply({value:[{id:second?"2":"1",from:{emailAddress:{address:"contact@example.com"}}}],...(second?{}:{"@odata.nextLink":"https://graph.microsoft.com/v1.0/users/owner%40example.com/mailFolders/inbox/messages?$skiptoken=opaque%2Bpage"})});}
   const outgoing=url.pathname.includes("sentitems");
   return reply({value:[{id:"one",receivedDateTime:"2026-09-28T10:00:00Z",from:{emailAddress:{address:"contact@example.com"}},toRecipients:[{emailAddress:{address:"factory@example.com"}}],isRead:false},{id:"two",receivedDateTime:"2026-09-27T10:00:00Z",from:{emailAddress:{address:"unknown@example.com"}},toRecipients:[],isRead:true}]});
  }
  if(url.pathname==="/rest/v1/clients")return reply([{id:"client",trade_name:"Cliente conhecido",email:null}]);
  if(url.pathname==="/rest/v1/client_contacts")return reply([{id:"contact",client_id:"client",email:"contact@example.com"}]);
  if(url.pathname==="/rest/v1/manufacturers")return reply([{id:"factory",name:"Fábrica",general_email:"factory@example.com"}]);
  if(url.pathname==="/rest/v1/manufacturer_contacts")return reply([]);
  throw new Error("Unexpected service call: "+url.pathname);
 });return calls;
}
test("rotas exigem sessão e perfil ativo antes de ler Graph",async t=>{let calls=mock(t);for(const fn of[list,message,entity])assert.equal((await fn(request("list",""))).status,401);assert.equal(calls.length,0);t.mock.restoreAll();mock(t,{inactive:true});assert.equal((await list(request("list"))).status,403);t.mock.restoreAll();mock(t,{invalid:true});assert.equal((await list(request("list"))).status,401);});
test("lista ao vivo, entidade/lead, pasta enviada e nenhuma escrita Supabase",async t=>{const calls=mock(t);const response=await list(request("list?folder=inbox&email=other@example.com"));assert.equal(response.status,200);assert.equal(response.headers.get("Cache-Control"),"no-store");const data=await response.json();assert.equal(data.mensagens[0].entidade.nome,"Cliente conhecido");assert.equal(data.mensagens[1].lead,true);assert.equal(data.nextPage,null);const sent=await(await list(request("list?folder=sentitems"))).json();assert.equal(sent.mensagens[0].entidade.nome,"Fábrica");assert.equal(sent.mensagens[1].lead,false);for(const call of calls.filter(c=>c.url.hostname==="graph.microsoft.com")){assert.equal(call.url.searchParams.get("$top"),"25");assert.match(call.url.searchParams.get("$orderby"),/DateTime desc/);}for(const call of calls.filter(c=>c.url.pathname.startsWith("/rest/")))assert.equal(call.init.method??"GET","GET");});
test("pesquisa não combina orderby; erros Graph propagam",async t=>{const calls=mock(t);assert.equal((await list(request("list?q=teste"))).status,200);const graph=calls.find(c=>c.url.hostname==="graph.microsoft.com");assert.equal(graph.url.searchParams.get("$search"),'"teste"');assert.equal(graph.url.searchParams.has("$orderby"),false);t.mock.restoreAll();mock(t,{graphError:true});assert.equal((await list(request("list"))).status,403);});
test("paginação segue nextLink exato e rejeita adulteração, troca de pasta e pesquisa",async t=>{const calls=mock(t,{pages:true});const first=await(await list(request("list"))).json();assert.ok(first.nextPage);const second=await(await list(request("list?page="+encodeURIComponent(first.nextPage)))).json();assert.equal(second.mensagens[0].id,"2");assert.equal(second.nextPage,null);assert.equal(calls.at(-1).url.searchParams.get("$skiptoken"),"opaque+page");for(const path of["list?folder=sentitems&page="+encodeURIComponent(first.nextPage),"list?q=changed&page="+encodeURIComponent(first.nextPage),"list?page=https://evil.test"]){assert.equal((await list(request(path))).status,400);}});
test("corpo usa caixa da sessão sem registo local nem marcação como lido",async t=>{const calls=mock(t);const result=await message(request("message?id=abc%2Fdef%3D"));assert.equal(result.status,200);assert.ok((await result.json()).body.content);assert.equal(calls.filter(c=>c.url.pathname.startsWith("/rest/")).length,1);assert.equal(calls.some(c=>["PATCH","PUT"].includes(c.init?.method)),false);assert.equal((await message(request("message?id=.."))).status,400);});
test("histórico pesquisa todos os participantes de cada endereço, deduplica e ordena",async t=>{const calls=mock(t);const result=await entity(request("by-entity?email=contact@example.com&email=CONTACT@example.com&email=second@example.com"));assert.equal(result.status,200);const data=await result.json();assert.equal(data.mensagens.length,2);assert.equal(data.mensagens[0].id,"one");assert.equal(data.nextPage,null);const graph=calls.filter(c=>c.url.hostname==="graph.microsoft.com");assert.equal(graph.length,2);assert.equal(graph[0].url.searchParams.get("$search"),'"participants:contact@example.com"');assert.equal(graph[0].url.pathname.endsWith("/users/owner%40example.com/messages"),true);assert.equal((await entity(request("by-entity?email=bad%22%20OR%20from:attacker"))).status,400);});
test("antiga sincronização está desativada e não contacta serviços",async t=>{const calls=mock(t);assert.equal((await POST()).status,410);assert.equal(calls.length,0);});
