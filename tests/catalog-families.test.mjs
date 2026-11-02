import test from 'node:test';
import assert from 'node:assert/strict';
import {familiesForManufacturer} from '../app/catalog-families.ts';
const rows=[{manufacturer_id:'acha',name:'Metrologia'},{manufacturer_id:'blue',name:'Brocas para metal'},{manufacturer_id:'blue',name:'BROCAS PARA METAL'},{manufacturer_id:'blue',name:'Serras de fita'}];
test('families only belong to selected manufacturer',()=>assert.deepEqual(familiesForManufacturer(rows,'blue'),['Brocas para metal','Serras de fita']));
test('switching manufacturer does not retain other brands',()=>assert.deepEqual(familiesForManufacturer(rows,'acha'),['Metrologia']));
test('empty and unknown manufacturers have no family options',()=>{assert.deepEqual(familiesForManufacturer(rows,''),[]);assert.deepEqual(familiesForManufacturer(rows,'missing'),[]);});
