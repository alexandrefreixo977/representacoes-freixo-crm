import type {SupabaseClient} from '@supabase/supabase-js';
import {localDate} from './notification-time';
type ScheduledActivity={hasTime:boolean;startAt:string;dueDate:string};
export function agendaActivityDay(item:ScheduledActivity,timezone:string){
 return item.hasTime?localDate(item.startAt,timezone):item.dueDate;
}
export function activitiesOnDay<T extends ScheduledActivity&{assignedId:string}>(items:T[],day:string,timezone:string,owner='all'){
 return items.filter(item=>agendaActivityDay(item,timezone)===day&&(owner==='all'||item.assignedId===owner))
  .sort((a,b)=>Number(a.hasTime)-Number(b.hasTime)||(a.hasTime?Date.parse(a.startAt)-Date.parse(b.startAt):0));
}
// Both screens load the same visible records, without truncating older scheduled items.
export async function loadAgendaActivities(db:SupabaseClient,columns:string){
 const rows:any[]=[];let offset=0;
 for(;;){
  const {data,error,count}=await db.from('activities').select(columns,{count:'exact'}).order('id').range(offset,offset+249);
  if(error)return {data:null,error};
  if(!data?.length)break;
  rows.push(...data);offset+=data.length;
  if(count!==null&&offset>=count)break;
 }
 return {data:rows,error:null};
}
