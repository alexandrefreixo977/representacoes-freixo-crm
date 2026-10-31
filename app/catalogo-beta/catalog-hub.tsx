"use client";
import {useEffect,useState} from 'react';
import CatalogEditor from './catalog-editor';
import CommercialDocuments from './commercial-documents';
import CatalogAdmin from './catalog-admin';
import {supabase} from '../supabase';
import './commercial.css';
export default function CatalogPage(){
 const [area,setArea]=useState('catalog'),[allowed,setAllowed]=useState<boolean|null>(null),[admin,setAdmin]=useState(false);
 useEffect(()=>{void supabase.rpc('commercial_is_admin').then(r=>setAdmin(r.data===true));},[]);
 useEffect(()=>{const q=new URLSearchParams(location.search);if(q.get('area')==='proposal'||q.get('area')==='order')setArea(q.get('area')!);if(q.has('document')||q.has('edit')||q.has('opportunity'))setArea('editor');void supabase.rpc('has_catalog_orders_beta_access').then(r=>setAllowed(!r.error&&r.data===true));},[]);
 if(allowed===null)return <main className="commercial-shell">A carregar catálogo…</main>;
 if(!allowed)return <main className="commercial-shell"><a href="/dashboard">Voltar ao CRM</a><p>Inicie sessão com um utilizador autorizado para aceder ao catálogo.</p></main>;
 return <main className="commercial-shell"><nav aria-label="Áreas do catálogo">{[['catalog','Catálogo de Produtos'],['new','Nova Operação'],['proposal','Orçamentos'],['order','Encomendas'],...(admin?[['admin','Administração']]:[])].map(([key,label])=><button key={key} aria-pressed={area===key} onClick={()=>setArea(key)}>{label}</button>)}<a href="/dashboard">Voltar ao CRM</a></nav>{area==='admin'&&admin?<CatalogAdmin/>:area==='new'?<section className="commercial-new"><h1>Nova operação comercial</h1><a href="/catalogo-beta?document=proposal">Novo Orçamento / Proposta Comercial</a><a href="/catalogo-beta?document=order">Nova Encomenda</a></section>:area==='proposal'||area==='order'?<CommercialDocuments kind={area}/>:<CatalogEditor/>}</main>;
}
