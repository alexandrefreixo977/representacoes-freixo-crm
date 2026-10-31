import assert from 'node:assert/strict';
import test from 'node:test';
import { inlineImages, replyRecipients } from '../app/mail-content.ts';
const image={id:'image',isInline:true,contentId:'<logo@test>',contentType:'image/png',contentBytes:'YWJj',name:'logo',size:3};
test('CID images handle case, quotes, encoding and preserve external images',()=>{
  const html=inlineImages('<IMG SRC="CID:logo%40test"><img src=cid:logo@test><img src=\'cid:logo@test\'><img src="https://external.test/image"><img src="cid:missing">',[image]);
  assert.equal(html.match(/data:image\/png;base64,YWJj/g).length,3);assert.match(html,/https:\/\/external.test/);assert.match(html,/cid:missing/);
});
test('inline images do not embed active content or arbitrary base64',()=>{assert.equal(inlineImages('<img src="cid:logo@test">',[{...image,contentType:'text/html'}]),'<img src="cid:logo@test">');assert.equal(inlineImages('<img src="cid:logo@test">',[{...image,contentBytes:'" onerror="bad'}]),'<img src="cid:logo@test">');});
const party=address=>({emailAddress:{address}});
test('reply-all preview honors replyTo, removes own address and duplicates across To/CC',()=>{
 const message={id:'m',from:party('sender@test.com'),replyTo:[party('reply@test.com')],toRecipients:[party('own@test.com'),party('other@test.com')],ccRecipients:[party('OWN@test.com'),party('other@test.com'),party('cc@test.com')]};
 assert.deepEqual(replyRecipients(message,'reply','own@test.com'),{to:['reply@test.com'],cc:[],bcc:[]});
 assert.deepEqual(replyRecipients(message,'replyAll','own@test.com'),{to:['reply@test.com','other@test.com'],cc:['cc@test.com'],bcc:[]});
 assert.deepEqual(replyRecipients(message,'forward','own@test.com'),{to:[],cc:[],bcc:[]});
});

