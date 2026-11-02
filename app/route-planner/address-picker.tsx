'use client';
import {useEffect,useMemo,useState} from 'react';
import RouteMap from './map';
type Props={initialAddress:string;apiKey:string|null;search:(address:string)=>Promise<any>;onSelect:(value:any)=>Promise<void>|void;onClose?:()=>void;automatic?:boolean;clientId?:string};
export default function AddressPicker({initialAddress,apiKey,search,onSelect,onClose,automatic=false,clientId}:Props){
 const [address,setAddress]=useState(initialAddress),[results,setResults]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false),[manual,setManual]=useState(false),[lat,setLat]=useState(''),[lng,setLng]=useState('');
 async function find(){setBusy(true);setError('');setSelected(null);setResults([]);try{const r=await search(address);setResults(r.candidates);setSearched(true);if(r.candidates.length===1)setSelected(r.candidates[0]);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{if(automatic)void find();},[]);
 const stops=useMemo(()=>selected?[{client_id:clientId,clients:{trade_name:selected.address,route_location:{...selected.location,validated:true}}}]:[],[selected,clientId]);
 async function confirm(){setBusy(true);setError('');try{await onSelect(manual?{latitude:Number(lat),longitude:Number(lng),source:'manual'}:{...selected.location,address,place_id:selected.placeId,proof:selected.proof,source:'google',expires_at:new Date(Date.now()+29*86400000).toISOString()});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="route-address-picker">
 <p>Confirme a posição exata no mapa. A morada não é alterada na ficha do cliente.</p>
 <label>Morada<input value={address} readOnly={!!clientId} placeholder="Rua, número, código postal e localidade" onChange={e=>{setAddress(e.target.value);setSelected(null);setResults([]);setSearched(false);}}/></label>
 {clientId&&<a href={`/clientes/${clientId}`}>Corrigir morada na ficha</a>}
 <button type="button" disabled={busy||address.trim().length<8} onClick={find}>{busy?'A pesquisar…':'Pesquisar morada'}</button>
 {error&&<p role="alert">{error}</p>}
 {searched&&!results.length&&<p>Não foi encontrada uma morada. Verifique a rua, número, código postal e localidade.</p>}
 {results.length>0&&<div><small translate="no">Google Maps</small>{results.map(c=><label key={c.placeId}><input type="radio" name="route-address-candidate" checked={selected?.placeId===c.placeId} onChange={()=>{setSelected(c);setManual(false);}}/>{c.address}{!c.precise&&<small>Localização aproximada — corrija a morada ou indique a posição na opção avançada.</small>}</label>)}</div>}
 {selected&&<RouteMap apiKey={apiKey} stops={stops}/>}
 <details onToggle={e=>setManual(e.currentTarget.open)}><summary>Opção avançada: coordenadas conhecidas</summary><label>Latitude<input type="number" min="-90" max="90" step="any" value={lat} onChange={e=>setLat(e.target.value)}/></label><label>Longitude<input type="number" min="-180" max="180" step="any" value={lng} onChange={e=>setLng(e.target.value)}/></label></details>
 <div className="route-toolbar">{onClose&&<button type="button" onClick={onClose} disabled={busy}>Cancelar</button>}<button className="primary" type="button" disabled={busy||(manual?lat===''||lng===''||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))||Math.abs(Number(lat))>90||Math.abs(Number(lng))>180:!selected?.precise)} onClick={confirm}>Confirmar esta localização</button></div>
 </div>;
}
