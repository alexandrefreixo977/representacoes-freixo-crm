'use client';
import {useState} from 'react';
import {agendaViews,agendaPeriod,moveAgenda,agendaDateLabel,monthLeadingDays,type AgendaView} from './agenda-period';
import {localDate,localTime} from './notification-time';
import {agendaActivityDay} from './agenda-activities';
import {agendaTypes,agendaType} from './agenda-colors';
import './agenda-calendar.css';

type Item={id:string;title:string;type:string;client:string;assigned:string;startAt:string;hasTime:boolean;dueDate:string};
export default function AgendaCalendar<T extends Item>({day,timezone,items,onDay,onSelect}:{day:string;timezone:string;items:T[];onDay:(day:string)=>void;onSelect:(item:T)=>void}){
 const [view,setView]=useState<AgendaView>(()=>{
  if(typeof window==='undefined')return 'week';
  const params=new URLSearchParams(window.location.search);
  if(params.has('date')||params.has('activity'))return 'day';
  try{const saved=localStorage.getItem('crm-agenda-view');return saved&&saved in agendaViews?saved as AgendaView:'week'}catch{return 'week'}
 });
 const days=agendaPeriod(day,view),today=localDate(new Date(),timezone);
 const changeView=(next:AgendaView)=>{setView(next);try{localStorage.setItem('crm-agenda-view',next)}catch{}};
 const byDay=new Map<string,T[]>();
 for(const item of items){const key=agendaActivityDay(item,timezone);if(!key)continue;const group=byDay.get(key)??[];group.push(item);byDay.set(key,group)}
 for(const group of byDay.values())group.sort((a,b)=>Number(a.hasTime)-Number(b.hasTime)||(a.hasTime?a.startAt.localeCompare(b.startAt):a.title.localeCompare(b.title)));
 const title=view==='month'?agendaDateLabel(days[0],{month:'long',year:'numeric'}):view==='day'?agendaDateLabel(day,{day:'numeric',month:'long',year:'numeric'}):`${agendaDateLabel(days[0],{day:'numeric',month:'short'})} — ${agendaDateLabel(days.at(-1)!,{day:'numeric',month:'short',year:'numeric'})}`;
 const event=(item:T)=>{const type=agendaType(item.type);return <button type="button" key={item.id} className="agenda-period-event" style={{backgroundColor:type.background,borderLeftColor:type.color}} onClick={()=>onSelect(item)}><b style={{color:type.color}}>{item.hasTime?localTime(item.startAt,timezone):'Sem hora'} · {type.key==='other'?item.type:type.label}</b><strong>{item.title}</strong><span>{item.client}</span><small>{item.assigned}</small></button>;};
 const daily=byDay.get(day)??[];
 return <section className="calendar card agenda-calendar"><div className="agenda-view-controls" role="group" aria-label="Visualização da agenda">{(Object.keys(agendaViews) as AgendaView[]).map(key=><button type="button" key={key} aria-pressed={view===key} className={view===key?'active':''} onClick={()=>changeView(key)}>{agendaViews[key]}</button>)}</div><div className="agenda-period-head"><button type="button" aria-label="Período anterior" onClick={()=>onDay(moveAgenda(day,view,-1))}>←</button><h2 aria-live="polite">{title}</h2><button type="button" onClick={()=>onDay(today)}>Hoje</button><button type="button" aria-label="Período seguinte" onClick={()=>onDay(moveAgenda(day,view,1))}>→</button></div>
 <div className="agenda-color-legend" role="group" aria-label="Legenda das cores por tipo de atividade"><strong>Legenda · tipo de atividade</strong><ul>{agendaTypes.map(type=><li key={type.key}><span aria-hidden="true" style={{backgroundColor:type.background,borderColor:type.color}}/>{type.label}</li>)}</ul></div>
 {view==='day'?<div>{['Sem hora',...Array.from({length:24},(_,h)=>String(h).padStart(2,'0')+':00')].map(hour=><div className="agenda-hour" key={hour}><time>{hour}</time><div>{daily.filter(item=>hour==='Sem hora'?!item.hasTime:item.hasTime&&localTime(item.startAt,timezone).slice(0,2)===hour.slice(0,2)).map(event)}</div></div>)}</div>:<div className={`agenda-period-grid agenda-period-${view}`}>
 {view==='month'&&['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(name=><div className="agenda-weekday" key={name}>{name}</div>)}
 {view==='month'&&Array.from({length:monthLeadingDays(days[0])},(_,i)=><div className="agenda-blank" aria-hidden="true" key={`blank-${i}`}/>)}
 {days.map(date=><section key={date} className={`agenda-date-card ${date===today?'is-today':''}`}><button type="button" className="agenda-date-heading" aria-label={`Abrir dia ${date}`} onClick={()=>{onDay(date);changeView('day')}}>{agendaDateLabel(date,{weekday:'short',day:'numeric',...(view==='month'?{}:{month:'short'})})}{date===today&&<em>Hoje</em>}</button>{(byDay.get(date)??[]).map(event)}{!byDay.get(date)?.length&&<p className="agenda-no-events">Sem atividades</p>}</section>)}
 </div>}
 {!days.some(date=>byDay.get(date)?.length)&&<p className="empty">Não existem atividades neste período com os filtros selecionados.</p>}
 </section>;
}
