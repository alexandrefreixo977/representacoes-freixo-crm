export type Leg = { seconds: number; meters: number };
export type Matrix = (Leg | null)[][];
export type Stop = { id: string; node: number; minutes: number; priority: number; day?: string; fixedMinute?: number; lockedPosition?: number; windowStart?: number; windowEnd?: number };
export type Day = { date: string; start: number; end: number; lunchStart: number; lunchEnd: number; maxVisits: number; margin: number; origin: number; destination: number };
export type ScheduledStop = Stop & { arrival: number; departure: number };
export type Evaluation = { feasible: boolean; stops: ScheduledStop[]; seconds: number; meters: number; errors: string[] };

export function evaluateDay(day: Day, stops: Stop[], matrix: Matrix): Evaluation {
  let now = day.start, node = day.origin, seconds = 0, meters = 0;
  const result: ScheduledStop[] = [], errors: string[] = [];
  if (stops.length > day.maxVisits) errors.push('Número máximo de visitas ultrapassado.');
  const travel = (target: number) => {
    const leg = matrix[node]?.[target];
    if (!leg || !Number.isFinite(leg.seconds) || !Number.isFinite(leg.meters) || leg.seconds < 0 || leg.meters < 0) { errors.push('Percurso rodoviário indisponível.'); return false; }
    // Lunch is unavailable for both travel and visits.
    const minutes = leg.seconds / 60;
    if (now < day.lunchEnd && now + minutes > day.lunchStart) now = day.lunchEnd;
    now += minutes; seconds += leg.seconds; meters += leg.meters; node = target; return true;
  };
  for (const [index, stop] of stops.entries()) {
    if (stop.day && stop.day !== day.date) errors.push(`${stop.id}: dia fixado incompatível.`);
    if (stop.lockedPosition !== undefined && stop.lockedPosition !== index) errors.push(`${stop.id}: posição fixada incompatível.`);
    if (!travel(stop.node)) return { feasible: false, stops: result, seconds, meters, errors };
    now = Math.max(Math.ceil(now + day.margin), stop.windowStart ?? day.start);
    if (stop.fixedMinute !== undefined) {
      if (now > stop.fixedMinute) errors.push(`${stop.id}: impossível chegar à hora confirmada.`);
      now = Math.max(now, stop.fixedMinute);
    } else if (now < day.lunchEnd && now + stop.minutes > day.lunchStart) now = day.lunchEnd;
    if (now < day.lunchEnd && now + stop.minutes > day.lunchStart) errors.push(`${stop.id}: sobreposição com almoço.`);
    const departure = now + stop.minutes;
    if (departure > Math.min(day.end, stop.windowEnd ?? day.end)) errors.push(`${stop.id}: fora do horário disponível.`);
    result.push({ ...stop, arrival: now, departure }); now = departure;
  }
  if (stops.length) travel(day.destination);
  if (now > day.end) errors.push('Chegada após o fim do horário de trabalho.');
  return { feasible: errors.length === 0, stops: result, seconds, meters, errors };
}

// Deterministic insertion heuristic: commercial priority first, then cheapest feasible
// insertion using the supplied ROAD matrix. Never substitutes straight-line distances.
export function optimizeWeek(days: Day[], stops: Stop[], matrix: Matrix) {
  if (new Set(stops.map(s => s.id)).size !== stops.length) throw new Error('Visitas duplicadas.');
  if (new Set(days.map(d => d.date)).size !== days.length) throw new Error('Dias duplicados.');
  for (const d of days) if (!(d.start < d.end && d.lunchStart <= d.lunchEnd && d.margin >= 0 && d.maxVisits > 0)) throw new Error('Horário inválido.');
  for (const s of stops) if (!(s.minutes > 0 && Number.isFinite(s.minutes) && Number.isFinite(s.priority))) throw new Error('Duração ou prioridade inválida.');
  const assigned = days.map(() => [] as Stop[]), unassigned: { id: string; reason: string }[] = [];
  const fixed = stops.filter(s => s.fixedMinute !== undefined || s.lockedPosition !== undefined);
  for (const stop of fixed) {
    const i = days.findIndex(d => d.date === stop.day);
    if (i < 0) unassigned.push({ id: stop.id, reason: 'Compromisso fixo num dia indisponível.' });
    else assigned[i].push(stop);
  }
  assigned.forEach(list => list.sort((a,b) => (a.lockedPosition ?? a.fixedMinute ?? 0) - (b.lockedPosition ?? b.fixedMinute ?? 0)));
  for (const stop of stops.filter(s => !fixed.includes(s)).sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id))) {
    let best: { day: number; list: Stop[]; cost: number } | null = null;
    days.forEach((day, di) => {
      if (stop.day && stop.day !== day.date) return;
      const baseline = evaluateDay(day, assigned[di], matrix);
      for (let at=0; at<=assigned[di].length; at++) {
        const list = [...assigned[di].slice(0,at),stop,...assigned[di].slice(at)];
        const evaluation = evaluateDay(day,list,matrix), cost = evaluation.seconds-baseline.seconds;
        if (evaluation.feasible && (!best || cost < best.cost)) best={day:di,list,cost};
      }
    });
    const choice = best as { day: number; list: Stop[]; cost: number } | null;
    if (choice) assigned[choice.day]=choice.list;
    else unassigned.push({id:stop.id,reason:'Sem espaço compatível com horários, compromissos, bloqueios e percursos disponíveis.'});
  }
  return { days: days.map((day,i)=>({date:day.date,...evaluateDay(day,assigned[i],matrix)})), unassigned, algorithm:'priority-feasible-insertion-v1', optimalityGuaranteed:false };
}

export function commercialScore(input: { daysSinceVisit?: number; frequencyDays?: number; openOpportunities: number; pendingProposals: number; overdueTasks: number; strategic: boolean }, weights = { opportunity:20, proposal:25, overdue:15, strategic:20, visitDue:20 }) {
  const reasons: string[] = []; let score=0;
  if(input.openOpportunities){score+=weights.opportunity;reasons.push(`${input.openOpportunities} oportunidades abertas`);}
  if(input.pendingProposals){score+=weights.proposal;reasons.push(`${input.pendingProposals} propostas pendentes`);}
  if(input.overdueTasks){score+=weights.overdue;reasons.push(`${input.overdueTasks} tarefas vencidas`);}
  if(input.strategic){score+=weights.strategic;reasons.push('Prioridade comercial definida na ficha');}
  if(input.daysSinceVisit!==undefined && input.frequencyDays!==undefined && input.daysSinceVisit>=input.frequencyDays){score+=weights.visitDue;reasons.push(`Última visita há ${input.daysSinceVisit} dias`);}
  return {score,reasons};
}
