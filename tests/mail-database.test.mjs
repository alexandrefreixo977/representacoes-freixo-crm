import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
// Optional isolated PostgreSQL runtime; kept out of the application's dependencies.
let PGlite;
try { ({ PGlite } = await import("../.tmp/mail-test-deps/node_modules/@electric-sql/pglite/dist/index.js")); } catch { /* Explicitly skipped below when the test runtime is absent. */ }

test("migração, RLS, histórico idempotente e rollback numa base PostgreSQL isolada", { skip: !PGlite }, async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const admin = "33333333-3333-4333-8333-333333333333";
  const client = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated;
      create table profiles(id uuid primary key, role text, active boolean default true);
      create table clients(id uuid primary key);
      create table client_contacts(id uuid primary key);
      create table manufacturers(id uuid primary key);
      create table activities(
        id uuid primary key default gen_random_uuid(), client_id uuid not null references clients,
        contact_id uuid references client_contacts, manufacturer_id uuid references manufacturers,
        kind text not null, interaction_type text not null, title text, subject text, summary text not null,
        description text, actor_id uuid not null references profiles, assigned_to uuid references profiles,
        occurred_at timestamptz not null, start_at timestamptz, status text, source_module text,
        entity_id uuid, updated_at timestamptz
      );
      alter table activities enable row level security;
      create policy activities_read on activities for select using(true);
      create policy activities_insert on activities for insert with check(actor_id=auth.uid());
      insert into profiles(id,role) values ('${owner}','commercial'),('${other}','commercial'),('${admin}','admin');
      insert into clients values('${client}');
    `);
    const migration = await readFile(new URL("../supabase/mail-messages-migration.sql", import.meta.url), "utf8");
    await db.exec(migration); await db.exec(migration);
    await db.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;
      set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const known = { graph_id: "known", direction: "in", from_address: "known@example.com", subject: "Teste conhecido", body_preview: "Mensagem de teste", client_id: client, owner_id: owner, received_at: "2026-09-28T10:00:00Z", is_read: false, is_lead: false };
    const lead = { graph_id: "lead", direction: "in", from_address: "unknown@example.com", subject: "Teste lead", owner_id: owner, received_at: "2026-09-28T11:00:00Z", is_read: false, is_lead: true };
    const sync = rows => db.query("select sync_mail_messages($1::jsonb) as result", [JSON.stringify(rows)]);
    assert.deepEqual((await sync([known, lead])).rows[0].result, { sincronizadas: 2, leads: 1 });
    await sync([known, lead]);
    assert.equal((await db.query("select count(*)::int as n from mail_messages")).rows[0].n, 2);
    const activities = await db.query("select * from activities");
    assert.equal(activities.rows.length, 1);
    assert.equal(activities.rows[0].summary, "Email recebido: Teste conhecido");
    assert.equal(activities.rows[0].actor_id, owner);
    assert.equal(activities.rows[0].assigned_to, owner);
    assert.equal(activities.rows[0].status, "completed");
    assert.equal(activities.rows[0].source_module, "mail");
    assert.equal((await db.query("select count(*)::int as n from activities a join mail_messages m on m.id=a.entity_id where a.client_id=m.client_id")).rows[0].n, 1);
    await db.exec("update mail_messages set is_read=true where graph_id='known'"); await sync([known]);
    assert.equal((await db.query("select is_read from mail_messages where graph_id='known'")).rows[0].is_read, true);
    await assert.rejects(sync([{ ...known, graph_id: "rollback" }, { ...known, graph_id: null }]));
    assert.equal((await db.query("select count(*)::int as n from mail_messages where graph_id='rollback'")).rows[0].n, 0);
    await assert.rejects(sync([{ ...known, owner_id: other }]));
    await sync([{ ...lead, client_id: client, is_lead: false }]);
    assert.equal((await db.query("select count(*)::int as n from activities")).rows[0].n, 2);
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    assert.equal((await db.query("select count(*)::int as n from mail_messages")).rows[0].n, 0);
    await assert.rejects(sync([{ ...known, owner_id: other }]));
    await db.exec(`set request.jwt.claim.sub='${admin}'`);
    assert.equal((await db.query("select count(*)::int as n from mail_messages")).rows[0].n, 2);
    await assert.rejects(db.exec("update mail_messages set is_read=false where graph_id='known'"));
  } finally { await db.close(); }
});
