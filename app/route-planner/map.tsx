'use client';
import {useEffect,useRef,useState} from 'react';
let loading:Promise<any>|undefined;
const noPolylines:string[]=[];
function loadMaps(key:string){
 if(!loading)loading=new Promise((resolve,reject)=>{
  const w=window as any;if(w.google?.maps){resolve(w.google.maps);return;}
  const script=document.createElement('script');
  w.rfRoutesMapReady=()=>resolve(w.google.maps);
  script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=rfRoutesMapReady&libraries=geometry&loading=async&language=pt-PT`;
  script.async=true;script.onerror=()=>{loading=undefined;reject(new Error('Não foi possível carregar o mapa.'));};document.head.appendChild(script);
 });return loading;
}
export default function RouteMap({apiKey,stops,polylines=noPolylines}:{apiKey:string|null;stops:any[];polylines?:string[]}){
 const el=useRef<HTMLDivElement>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!apiKey)return;let disposed=false;const overlays:any[]=[];
  loadMaps(apiKey).then(maps=>{
   if(disposed||!el.current)return;
   const map=new maps.Map(el.current,{center:{lat:39.7,lng:-8},zoom:7,mapTypeControl:false,streetViewControl:false});
   const bounds=new maps.LatLngBounds();
   // Cluster identical/nearby positions at this overview scale. Zoom a cluster to inspect.
   const groups=new Map<string,any[]>();
   for(const s of stops){const p=s.clients?.route_location;if(!p?.validated)continue;const k=`${Number(p.latitude).toFixed(3)},${Number(p.longitude).toFixed(3)}`;groups.set(k,[...(groups.get(k)||[]),s]);}
   for(const group of groups.values()){
    const p=group[0].clients.route_location,position={lat:Number(p.latitude),lng:Number(p.longitude)};bounds.extend(position);
    const marker=new maps.Marker({map,position,label:group.length>1?String(group.length):undefined,title:group.map(s=>s.clients.trade_name).join(' · ')});overlays.push(marker);
    marker.addListener('click',()=>{const content=document.createElement('div');for(const s of group){const a=document.createElement('span');a.textContent=s.clients.trade_name;content.append(a,document.createElement('br'));}new maps.InfoWindow({content}).open({map,anchor:marker});});
   }
   for(const encoded of polylines){const path=maps.geometry.encoding.decodePath(encoded);overlays.push(new maps.Polyline({map,path,strokeColor:'#ae841b',strokeWeight:4}));for(const p of path)bounds.extend(p);}
   if(!bounds.isEmpty()){map.fitBounds(bounds,50);maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>18)map.setZoom(18);});}
  }).catch(e=>!disposed&&setError(e.message));
  return()=>{disposed=true;overlays.forEach(o=>o.setMap(null));};
 },[apiKey,stops,polylines]);
 if(!apiKey)return <div className="route-notice">Mapa indisponível até configurar a chave Google Maps restrita ao domínio do CRM.</div>;
 return <>{error&&<p role="alert">{error}</p>}<div ref={el} aria-label="Mapa das visitas com localização validada" style={{height:360,borderRadius:12,marginBottom:20}}/></>;
}
