export const addressKey=(c:any)=>[c.address,c.postal_code,c.city,c.country||'Portugal'].map(v=>String(v||'').trim().toLocaleLowerCase('pt-PT')).join('|');
export function currentLocation(c:any,now=Date.now()) {
 const p=c?.route_location;
 return !!p?.validated && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && (!p.address_key||p.address_key===addressKey(c)) && (!p.expires_at||Date.parse(p.expires_at)>now);
}
