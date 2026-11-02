import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaPeriod,moveAgenda,agendaDateLabel,monthLeadingDays} from '../app/agenda-period.ts';
test('day, Monday-based week and exactly 15 days cross month boundaries',()=>{
 assert.deepEqual(agendaPeriod('2026-10-20','day'),['2026-10-20']);
 const week=agendaPeriod('2026-10-20','week');assert.equal(week[0],'2026-10-19');assert.equal(week.at(-1),'2026-10-25');
 const days=agendaPeriod('2026-10-25','fortnight');assert.equal(days.length,15);assert.equal(days.at(-1),'2026-11-08');
});
test('month length, leap year, grid alignment and navigation',()=>{
 assert.equal(agendaPeriod('2028-02-29','month').length,29);
 assert.equal(agendaPeriod('2026-02-28','month').length,28);
 assert.equal(monthLeadingDays('2026-10-01'),3);
 assert.equal(moveAgenda('2026-12-31','month',1),'2027-01-01');
 assert.equal(moveAgenda('2026-10-20','fortnight',-1),'2026-10-05');
 assert.equal(moveAgenda('2026-10-20','week',1),'2026-10-27');
});
test('calendar dates do not skip or duplicate days across Lisbon clock change',()=>{
 const days=agendaPeriod('2026-10-20','fortnight');assert.equal(new Set(days).size,15);
 assert.equal(days[5],'2026-10-25');assert.equal(days[6],'2026-10-26');
 assert.match(agendaDateLabel('2026-10-25',{day:'numeric',month:'long'}),/25/);
});
