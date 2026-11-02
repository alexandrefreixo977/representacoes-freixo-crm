const encoder=new TextEncoder();
async function key(secret:string){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signLocation(payload:any,secret:string){
 const text=JSON.stringify({...payload,expires:Date.now()+30*60*1000});
 const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(text));
 return {text,signature:Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('')};
}
export async function verifyLocation(proof:any,secret:string,scope:string){
 if(typeof proof?.text!=='string'||proof.text.length>8000||!/^([a-f0-9]{2}){32}$/.test(proof?.signature||''))throw new Error('Pesquise novamente a morada.');
 const bytes=Uint8Array.from(proof.signature.match(/../g), (v:any)=>parseInt(v,16));
 if(!await crypto.subtle.verify('HMAC',await key(secret),bytes,encoder.encode(proof.text)))throw new Error('Localização inválida. Pesquise novamente.');
 const value=JSON.parse(proof.text);
 if(value.scope!==scope||value.expires<Date.now()||value.precise!==true)throw new Error('Confirme uma morada exata através de nova pesquisa.');
 return value;
}
