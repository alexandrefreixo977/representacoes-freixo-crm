import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleUrl } from './mail-module.mjs';
const {GET:message}=await import(await moduleUrl(new URL('../app/api/mail/message/route.ts',import.meta.url)));
const {GET:attachment}=await import(await moduleUrl(new URL('../app/api/mail/attachment/route.ts',import.meta.url)));
const {POST:reply}=await import(await moduleUrl(new URL('../app/api/mail/reply/route.ts',import.meta.url)));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://crm.example.com',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',MICROSOFT_TENANT_ID:'tenant',MICROSOFT_CLIENT_ID:'client',MICROSOFT_CLIENT_SECRET:'secret'});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const request=(path,body,auth='Bearer test')=>new Request('https://crm.local/api/mail/'+path,{headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
function mock(t,options={}){
 const calls=[];t.mock.method(globalThis,'fetch',async(input,init)=>{
  const url=new URL(String(input));calls.push({url,init});
  if(url.pathname==='/auth/v1/user')return response({id:'owner',email:'owner@example.com'});
  if(url.pathname==='/rest/v1/profiles')return response({id:'owner',active:true});
  if(url.hostname==='login.microsoftonline.com')return response({access_token:'token'});
  if(url.hostname==='graph.microsoft.com'){
   assert.match(url.pathname,/^\/v1.0\/users\/owner%40example.com\/messages\//);
   if(init.method==='POST')return options.fail?response({error:{}},403):new Response(null,{status:202});
   if(url.pathname.endsWith('/attachments/image'))return response({id:'image',name:'logo.png',isInline:true,contentId:'logo@test',contentType:'image/png',size:3,contentBytes:'YWJj'});
   if(url.pathname.endsWith('/attachments/file'))return response({id:'file',name:'info.txt',contentType:'text/plain',contentBytes:'aGVsbG8='});
   if(url.pathname.endsWith('/attachments'))return response({value:[{id:'image',name:'logo.png',isInline:true,size:3,contentType:'image/png'},{id:'file',name:'info.txt',isInline:false,size:5,contentType:'text/plain'}]});
   return response({id:'message',hasAttachments:false,body:{contentType:'html',content:'<img src="cid:logo@test"><img src="https://external.test/a.png">'},ccRecipients:[{emailAddress:{address:'cc@test.com'}}]});
  }
  throw new Error('Unexpected service '+url.pathname);
 });return calls;
}
test('inline-only message fetches attachments and embeds bytes, returns metadata without duplicating file contents',async t=>{
 const calls=mock(t);const result=await message(request('message?id=message'));assert.equal(result.status,200);const data=await result.json();assert.match(data.body.content,/data:image\/png;base64,YWJj/);assert.equal(data.attachments.length,2);assert.ok(data.attachments.every(a=>a.contentBytes===undefined));assert.equal(data.ccRecipients.length,1);assert.ok(calls.some(c=>c.url.pathname.endsWith('/attachments')));assert.ok(!calls.some(c=>c.url.pathname.endsWith('/attachments/file')));
});
test('download is authorized by session mailbox and IDs validated before Graph',async t=>{
 const calls=mock(t);assert.equal((await attachment(request('attachment?messageId=m&attachmentId=file','', ''))).status,401);assert.equal(calls.length,0);
 assert.equal((await attachment(request('attachment?messageId=..&attachmentId=file'))).status,400);
 const result=await attachment(request('attachment?messageId=m&attachmentId=file'));assert.equal(result.headers.get('Cache-Control'),'no-store');assert.deepEqual(await result.json(),{name:'info.txt',contentType:'text/plain',contentBytes:'aGVsbG8='});
});
