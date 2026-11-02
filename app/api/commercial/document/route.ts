import { mailError,json,MailError } from '../../mail/server';
import { commercialSession,commercialService,documentSnapshot,bytesToBase64,sha256,commercialFilename } from '../server';
import { commercialPdf } from '../../../commercial-pdf';

export async function POST(request:Request){try{
 const {db,user,profile}=await commercialSession(request);
 const {id,action,previewHash}=await request.json() as {id:string;action:'preview'|'approve'|'approved';previewHash?:string};
 const {document,snapshot}=await documentSnapshot(db,id);
 if(action==='approved'){
  const v=await db.from('catalog_document_versions').select('*').eq('id',document.approved_version_id).single();if(v.error)throw new MailError(404,'Ainda não existe PDF aprovado.');
  return json({filename:v.data.filename,contentBytes:v.data.pdf_base64,sha256:v.data.pdf_sha256});
 }
 if(!['preview','approve'].includes(action))throw new MailError(400,'Ação inválida.');
 if(action==='approve'&&profile.role!=='admin')throw new MailError(403,'A validação está reservada à administração.');
 const origin=new URL(request.url).origin;
 const assets=await Promise.all(['/email-signature-logo.png','/fonts/DejaVuSans.ttf'].map(path=>fetch(new URL(path,origin))));
 if(assets.some(r=>!r.ok))throw new MailError(503,'Logótipo ou fonte do documento indisponíveis.');
 const [logo,font]=await Promise.all(assets.map(async r=>new Uint8Array(await r.arrayBuffer())));
 // Stable creation metadata makes preview bytes reproducible for the approval fingerprint.
 const bytes=await commercialPdf(snapshot,logo,font),hash=await sha256(bytes),contentBytes=bytesToBase64(bytes),filename=commercialFilename(snapshot);
 const snapshotHash=await sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
 if(action==='approve'){
  if(!previewHash||previewHash!==snapshotHash)throw new MailError(409,'Pré-visualize a versão atual antes de validar.');
  const saved=await commercialService().rpc('commercial_approve',{did:id,expected_version:document.row_version,actor:user.id,snapshot,pdf:contentBytes,sha:hash,filename});
  if(saved.error)throw new MailError(409,saved.error.message);
 }
 const missing=['legal_name','address','tax_number','phone'].filter(key=>!snapshot.company[key as keyof typeof snapshot.company]);
 return json({filename,contentBytes,sha256:hash,previewHash:snapshotHash,missingCompanyFields:missing,approved:action==='approve'});
}catch(error){return mailError(error);}}
