import test from 'node:test';import assert from 'node:assert/strict';import{moduleUrl}from './mail-module.mjs';
const {activitiesOnDay,agendaActivityDay}=await import(await moduleUrl(new URL('../app/agenda-activities.ts',import.meta.url)));
test('today matches agenda including undated times, completed records and timezone midnight',()=>{
 const items=[{id:1,hasTime:false,dueDate:'2026-10-20',startAt:'2026-10-01T09:00:00Z',assignedId:'lucia',status:'scheduled'},{id:2,hasTime:true,dueDate:'',startAt:'2026-10-19T23:30:00Z',assignedId:'lucia',status:'completed'},{id:3,hasTime:false,dueDate:'2026-10-21',startAt:'2026-10-20T09:00:00Z',assignedId:'lucia',status:'scheduled'},{id:4,hasTime:true,dueDate:'',startAt:'2026-10-20T10:00:00Z',assignedId:'alex',status:'scheduled'}];
 assert.deepEqual(activitiesOnDay(items,'2026-10-20','Europe/Lisbon').map(x=>x.id),[1,2,4]);
 assert.deepEqual(activitiesOnDay(items,'2026-10-20','Europe/Lisbon','lucia').map(x=>x.id),[1,2]);
 assert.equal(agendaActivityDay(items[0],'Europe/Lisbon'),'2026-10-20');
});
