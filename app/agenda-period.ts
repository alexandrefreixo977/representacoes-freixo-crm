import {Temporal} from '@js-temporal/polyfill';
export type AgendaView='day'|'week'|'fortnight'|'month';
export const agendaViews:Record<AgendaView,string>={day:'Dia',week:'Semana',fortnight:'15 dias',month:'Mês'};
export function agendaPeriod(anchor:string,view:AgendaView){
 const date=Temporal.PlainDate.from(anchor);
 const start=view==='month'?date.with({day:1}):view==='week'?date.subtract({days:date.dayOfWeek-1}):date;
 const length=view==='month'?start.daysInMonth:view==='fortnight'?15:view==='week'?7:1;
 return Array.from({length},(_,i)=>start.add({days:i}).toString());
}
export function moveAgenda(anchor:string,view:AgendaView,direction:number){
 const date=Temporal.PlainDate.from(anchor);
 return (view==='month'?date.with({day:1}).add({months:direction}):date.add({days:direction*(view==='fortnight'?15:view==='week'?7:1)})).toString();
}
export function agendaDateLabel(date:string,options:Intl.DateTimeFormatOptions){
 return new Intl.DateTimeFormat('pt-PT',{...options,timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
}
export function monthLeadingDays(date:string){return Temporal.PlainDate.from(date).dayOfWeek-1;}
