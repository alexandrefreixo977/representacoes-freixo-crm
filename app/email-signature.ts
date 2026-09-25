import { COMPANY_EMAIL_CONFIG } from "./company-config.ts";

export type EmailSignatureProfile={
  name?:string|null;title?:string|null;email?:string|null;phone?:string|null;address?:string|null;postalCode?:string|null;locality?:string|null;country?:string|null;qrUrl?:string|null;enabled?:boolean|null;
};

export const RF_SIGNATURE_MARKER="data-rf-email-signature";

const esc=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const clean=(value?:string|null)=>esc(String(value??"").trim());
const telHref=(value:string)=>value.replace(/[^+\d]/g,"");
const addressParts=(profile:EmailSignatureProfile)=>{
  const lines=String(profile.address??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const place=[profile.postalCode,profile.locality].map(x=>String(x??"").trim()).filter(Boolean).join(" ");
  const country=String(profile.country??"").trim();
  const normalized=lines.join(" ").toLocaleLowerCase("pt-PT");
  if(place&&!normalized.includes(place.toLocaleLowerCase("pt-PT")))lines.push(country?`${place} - ${country}`:place);
  else if(country&&!normalized.includes(country.toLocaleLowerCase("pt-PT")))lines.push(country);
  return lines;
};

export function generateEmailSignature(profile:EmailSignatureProfile,logoUrl:string){
  if(profile.enabled===false)return {html:"",text:""};
  const name=clean(profile.name).toUpperCase(),title=clean(profile.title),email=clean(profile.email),phone=clean(profile.phone),qrUrl=clean(profile.qrUrl),logo=clean(logoUrl);
  const addressLines=addressParts(profile).map(clean).join("<br>");
  const icon=`width:19px;padding:2px 6px 2px 0;font:bold 15px Arial,Helvetica,sans-serif;line-height:15px;color:#d9b51f;text-align:center;vertical-align:middle`;
  const value=`padding:2px 0;font:12px Arial,Helvetica,sans-serif;line-height:15px;color:#111827;vertical-align:middle`;
  const contact=[phone?`<tr><td style="${icon}">&#9742;</td><td style="${value}"><a href="tel:${telHref(phone)}" style="color:#111827;text-decoration:none">${phone}</a></td></tr>`:"",email?`<tr><td style="${icon}">&#9993;</td><td style="${value}"><a href="mailto:${email}" style="color:#111827;text-decoration:none">${email}</a></td></tr>`:"",`<tr><td style="${icon}">&#9673;</td><td style="${value}"><a href="${COMPANY_EMAIL_CONFIG.websiteUrl}" style="color:#111827;text-decoration:none">${COMPANY_EMAIL_CONFIG.website}</a></td></tr>`,addressLines?`<tr><td style="${icon};vertical-align:top">&#9679;</td><td style="${value};padding-top:8px">${addressLines}</td></tr>`:""].join("");
  const activityLine=COMPANY_EMAIL_CONFIG.activityLine.replace(/ /g,"&nbsp;");
  const left=logo?`<td width="173" style="width:173px;padding:8px 11px 8px 0;vertical-align:middle"><img src="${logo}" width="133" height="78" alt="Representações Freixo" style="display:block;width:133px;height:78px;border:0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td nowrap="nowrap" style="padding-top:7px;font:8px Arial,Helvetica,sans-serif;letter-spacing:.8px;color:#34363a;white-space:nowrap">${activityLine}</td></tr></table><div style="margin:6px 0 5px;border-top:1px solid #d9b51f;font-size:1px;line-height:1px">&nbsp;</div><div style="font:8px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#555d66;text-align:center">${COMPANY_EMAIL_CONFIG.valueLine}</div></td>`:"";
  const right=qrUrl?`<td width="84" style="width:84px;padding:6px 0 6px 14px;border-left:1px solid #d9dde3;text-align:center;vertical-align:middle"><img src="${qrUrl}" width="74" height="74" alt="QR Code" style="display:block;width:74px;height:74px;border:0;margin:0 auto"><div style="padding-top:6px;font:8px Arial,Helvetica,sans-serif;line-height:11px;letter-spacing:1px;color:#34363a">CONECTE-SE<br>CONNOSCO</div></td>`:"";
  const html=`<table ${RF_SIGNATURE_MARKER}="true" role="presentation" width="461" cellpadding="0" cellspacing="0" border="0" style="width:461px;max-width:100%;border-collapse:collapse;background:#ffffff"><tr>${left}<td width="204" style="width:204px;padding:8px 11px;border-left:1px solid #d9b51f;vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td colspan="2" style="padding:0 0 2px;font:bold 17px Arial,Helvetica,sans-serif;line-height:19px;color:#111827;white-space:nowrap">${name}</td></tr>${title?`<tr><td colspan="2" style="padding:0 0 13px;font:13px Arial,Helvetica,sans-serif;line-height:16px;color:#59616a">${title}</td></tr>`:""}${contact}</table></td>${right}</tr></table>`;
  const plainAddress=addressParts(profile).join("\n");
  const text=[profile.name,profile.title,profile.phone,profile.email,COMPANY_EMAIL_CONFIG.website,plainAddress].map(x=>String(x??"").trim()).filter(Boolean).join("\n");
  return {html,text};
}
