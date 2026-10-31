import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOpportunityClients} from '../app/opportunity-clients.ts';

function database(rows,cap=250,fail=false){
 const ranges=[];const filters=[];
 return {ranges,filters,from(table){assert.equal(table,'clients');let start,end;const q={
 select(){return q},is(column,value){assert.equal(column,'archived_at');assert.equal(value,null);return q},
 order(){return q},range(a,b){start=a;end=b;ranges.push([a,b]);return q},abortSignal(){return q},or(value){filters.push(value);return q},
 then(resolve){return Promise.resolve({data:rows.slice(start,Math.min(end+1,start+cap)),count:rows.length,error:fail?{message:'offline'}:null}).then(resolve)}
 };return q;}};
}
test('loads clients beyond first 50 and server page cap, preserving all references',async()=>{
 const rows=Array.from({length:551},(_,id)=>({id:String(id),trade_name:`Cliente ${id}`,email:''}));
 const db=database(rows,100);const result=await loadOpportunityClients(db,'',new AbortController().signal);
 assert.deepEqual(result,rows);assert.equal(db.ranges.length,6);assert.equal(result.at(-1).id,'550');
});
test('search applies on every page and failed reads are not accepted as complete',async()=>{
 const db=database(Array.from({length:260},(_,id)=>({id:String(id)})));
 await loadOpportunityClients(db,'Vedaplás',new AbortController().signal);
 assert.equal(db.filters.length,2);assert.ok(db.filters.every(x=>x.includes('trade_name.ilike.%Vedaplás%')));
 await assert.rejects(loadOpportunityClients(database([],250,true),'',new AbortController().signal),/offline/);
});
test('cancelled search never issues more requests',async()=>{
 const controller=new AbortController();controller.abort();const db=database([]);
 assert.deepEqual(await loadOpportunityClients(db,'',controller.signal),[]);assert.equal(db.ranges.length,0);
});
