import test from 'node:test';import assert from 'node:assert/strict';
import {parseCsv,normalizeImport,validateImport} from '../app/catalog-import.ts';
test('CSV com vírgula decimal, aspas e mudança de linha',()=>{const rows=normalizeImport(parseCsv('Referência;Designação;PVP\r\n001;"Ferramenta; tamanho\nL";12,90'));assert.equal(rows[0].reference,'001');assert.equal(rows[0].price,'12.90');assert.equal(rows[0].designation,'Ferramenta; tamanho\nL');assert.equal(validateImport(rows).errors.length,0);});
test('deteta duplicados e preços sem valor oficial',()=>{const rows=normalizeImport(parseCsv('Referencia;Designacao;PVP\n001;A;10\n001;B;0'));assert.equal(validateImport(rows).errors.length,2);});
test('rejeita ficheiro sem cabeçalhos oficiais',()=>assert.throws(()=>normalizeImport([['Nome'],['Algo']]),/necessárias/));
test('rejeita CSV com aspas por fechar',()=>assert.throws(()=>parseCsv('a,b\n"abc'),/aspas/));
