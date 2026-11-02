import { mailSession, mailError, json, MailError } from '../mail/server';
import { alertGroup, localDate, scheduleInstant, validTimezone,reminderOffsets } from '../../notification-time';

export async function GET(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const [prefs, items, reads, occurrences] = await Promise.all([
      db.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      db.from('notification_items').select('*').eq('user_id', user.id).order('starts_at', { ascending: true, nullsFirst: false }).limit(2000),
      db.from('notification_reads').select('source_table,item_id,revision').eq('user_id', user.id),
      db.from('notification_occurrences').select('*').eq('user_id', user.id).eq('status', 'active').gte('expires_at', new Date().toISOString()).lte('scheduled_for', new Date(Date.now() + 300000).toISOString()),
    ]);
    for (const result of [prefs,items,reads,occurrences]) if (result.error) throw new Error(result.error.message);
    const timezone = prefs.data?.timezone ?? 'Europe/Lisbon';
    const relevant = (items.data ?? []).filter(i => (i.category === 'task' ? prefs.data?.tasks_enabled !== false : prefs.data?.agenda_enabled !== false)).map(i => ({ ...i, group: alertGroup(i, timezone), read: reads.data?.some(r => r.source_table === i.source_table && r.item_id === i.id && r.revision === i.revision) ?? false })).filter(i => i.group && (i.group !== 'overdue' || prefs.data?.overdue !== false));
    return json({ preferences: prefs.data, items: relevant, occurrences: occurrences.data, limited: items.data?.length === 2000 });
  } catch (error) { return mailError(error); }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const body = await request.json();
    const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };
    if (body.action === 'preferences') {
      const allowed = ['timezone','in_app','push','tasks_enabled','agenda_enabled','overdue','daily_summary','task_offsets','agenda_offsets','quiet_enabled','quiet_start','quiet_end'];
      const values = Object.fromEntries(allowed.filter(k => body.values?.[k] !== undefined).map(k => [k, body.values[k]]));
      if (values.timezone && !validTimezone(String(values.timezone))) throw new MailError(400,'Fuso horário inválido.');
      check(await db.from('notification_preferences').upsert({ ...values, user_id: user.id }));
    } else if (body.action === 'daily') {
      const p = await db.from('notification_preferences').select('timezone,daily_summary,in_app').eq('user_id',user.id).single(); check(p);
      if (!p.data?.daily_summary || !p.data.in_app) return json({ claimed: false });
      const result = await db.from('notification_daily_views').insert({user_id:user.id,day:localDate(Date.now(),p.data.timezone)});
      if (result.error?.code==='23505') return json({claimed:false}); check(result); return json({claimed:true});
    } else if (body.action === 'toast') {
      const o=await db.from('notification_occurrences').select('*').eq('id',body.id).eq('user_id',user.id).eq('status','active').single(); check(o);
      if (!o.data || Date.parse(o.data.scheduled_for)>Date.now() || Date.parse(o.data.expires_at)<=Date.now()) return json({claimed:false});
      const i=await db.from('notification_items').select('revision').eq('id',o.data.item_id).eq('source_table',o.data.source_table).eq('user_id',user.id).maybeSingle(); check(i);
      if(i.data?.revision!==o.data.revision) return json({claimed:false});
      const result=await db.from('notification_toast_receipts').insert({user_id:user.id,occurrence_id:body.id});
      if(result.error?.code==='23505')return json({claimed:false});check(result);return json({claimed:true});
    } else if (body.action === 'read' || body.action === 'complete' || body.action === 'reschedule') {
      if(!['tasks','activities'].includes(body.source)) throw new MailError(400,'Origem inválida.');
      const item=await db.from('notification_items').select('*').eq('source_table',body.source).eq('id',body.id).eq('user_id',user.id).single();check(item);
      if(!item.data)throw new MailError(404,'O registo já não está pendente.');
      if(body.action==='read') check(await db.from('notification_reads').upsert({user_id:user.id,source_table:body.source,item_id:body.id,revision:item.data.revision,read_at:new Date().toISOString()}));
      else {
        if(item.data.category!=='task') throw new MailError(400,'Abra o evento na Agenda para o alterar.');
        const now=new Date().toISOString();
        let values: Record<string,unknown>={status:'completed',completed_at:now,updated_at:now,...(body.source==='activities'?{completed_by:user.id}:{})};
        if(body.action==='reschedule') {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date))throw new MailError(400,'Data inválida.');
          const pref=await db.from('notification_preferences').select('timezone').eq('user_id',user.id).maybeSingle();check(pref);
          const timezone=pref.data?.timezone??'Europe/Lisbon';
          const instant=body.time?scheduleInstant(body.date,body.time,timezone):null;
          values={status:body.source==='tasks'?'open':'scheduled',completed_at:null,updated_at:now,has_time:!!body.time,due_date:body.date,schedule_timezone:timezone,[body.source==='tasks'?'due_at':'start_at']:instant,...(body.reminder!==undefined?{reminder_offsets:reminderOffsets(body.reminder)}:{})};
        }
        check(await db.from(body.source).update(values).eq('id',body.id));
      }
    } else throw new MailError(400,'Ação inválida.');
    return json({ok:true});
  } catch(error) {return mailError(error);}
}
