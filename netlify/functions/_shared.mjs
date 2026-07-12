// מודול משותף בין api.mjs (אפליקציית הלקוח) ל-admin.mjs (מסך הניהול).
// קידומת "_" בשם הקובץ מסמנת ל-Netlify שלא לפרוס אותו כפונקציה בפני עצמה —
// הוא רק ניתן לייבוא משאר קבצי netlify/functions.
import { getStore } from '@netlify/blobs';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* מנרמל מספר טלפון להשוואה (תואם ל-normPhone בצד הלקוח) — כדי לזהות חבר קיים לפי הנייד */
export function normPhone(p){
  let d = String(p || '').replace(/\D/g, '');
  if(d.startsWith('00')) d = d.slice(2);
  if(d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}
/* בודק האם memberId "שקול" למנהל — זהה בפועל, או שכפול-נייד ישן של אותו אדם (מ-DB לפני תיקון ה-dedup) */
export function isEffectiveAdmin(members, memberId, adminId){
  if(!adminId) return false;
  if(memberId === adminId) return true;
  const me = members.find(m => m.id === memberId);
  const admin = members.find(m => m.id === adminId);
  const meP = me && normPhone(me.phone), adminP = admin && normPhone(admin.phone);
  return !!(meP && adminP && meP === adminP);
}

/* ---------- Postgres (Netlify DB / Neon) ---------- */
let sqlClient = null;
let schemaReady = null;

export async function db(){
  if(!process.env.NETLIFY_DATABASE_URL) return null;
  if(!sqlClient){
    const { neon } = await import('@neondatabase/serverless');
    sqlClient = neon(process.env.NETLIFY_DATABASE_URL);
  }
  if(!schemaReady){
    const sql = sqlClient;
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS families(
        id text PRIMARY KEY,
        code text UNIQUE NOT NULL,
        name text NOT NULL,
        region text,
        created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`ALTER TABLE families ADD COLUMN IF NOT EXISTS admin_member_id text`;
      await sql`CREATE TABLE IF NOT EXISTS members(
        id text PRIMARY KEY,
        family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        name text NOT NULL,
        phone text,
        joined_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS members_family_idx ON members(family_id)`;
      await sql`CREATE TABLE IF NOT EXISTS sessions(
        id bigserial PRIMARY KEY,
        member_id text REFERENCES members(id) ON DELETE CASCADE,
        family_id text,
        kind text,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS sessions_member_idx ON sessions(member_id)`;
      await sql`CREATE TABLE IF NOT EXISTS lists(
        family_id text PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
        data jsonb NOT NULL,
        updated_at bigint NOT NULL,
        updated_by text,
        updated_by_name text)`;
      await sql`CREATE TABLE IF NOT EXISTS purchases(
        id text PRIMARY KEY,
        family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        date timestamptz NOT NULL,
        duration_ms bigint,
        total numeric,
        items_count int,
        bought_count int,
        region text,
        shopper_name text,
        record jsonb NOT NULL)`;
      await sql`CREATE INDEX IF NOT EXISTS purchases_family_idx ON purchases(family_id, date DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS purchases_region_idx ON purchases(region)`;
      await sql`CREATE TABLE IF NOT EXISTS stores(
        id text PRIMARY KEY,
        chain text NOT NULL,
        name text NOT NULL,
        region text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(chain, name))`;
      await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS store_id text`;
      await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS chain text`;
      await sql`CREATE INDEX IF NOT EXISTS purchases_chain_idx ON purchases(chain)`;
      await sql`CREATE TABLE IF NOT EXISTS deals(
        id bigserial PRIMARY KEY,
        store text,
        region text,
        emoji text,
        title text NOT NULL,
        description text,
        tag text,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now())`;
    })();
  }
  await schemaReady;
  return sqlClient;
}

/* מיגרציה עצלה: מעתיקה משפחה קיימת מ-Blobs ל-DB (פעם אחת) */
export async function ensureFamilyInDb(sql, familyId){
  const rows = await sql`SELECT id FROM families WHERE id = ${familyId}`;
  if(rows.length) return true;
  const fam = await getStore('families').get(familyId, { type: 'json' });
  if(!fam) return false;
  await migrateFamilyToDb(sql, fam);
  return true;
}
export async function migrateFamilyToDb(sql, fam){
  await sql`INSERT INTO families(id, code, name, region, created_at)
    VALUES(${fam.id}, ${fam.code}, ${fam.name}, ${fam.region || 'אחר'}, to_timestamp(${(fam.createdAt || Date.now()) / 1000}))
    ON CONFLICT (id) DO NOTHING`;
  for(const m of (fam.members || [])){
    await sql`INSERT INTO members(id, family_id, name, phone, joined_at)
      VALUES(${m.id}, ${fam.id}, ${m.name}, ${m.phone || ''}, to_timestamp(${(m.joinedAt || Date.now()) / 1000}))
      ON CONFLICT (id) DO NOTHING`;
  }
  const list = await getStore('lists').get(fam.id, { type: 'json' });
  if(list){
    await sql`INSERT INTO lists(family_id, data, updated_at, updated_by, updated_by_name)
      VALUES(${fam.id}, ${JSON.stringify(list.data)}::jsonb, ${list.updatedAt || 0}, ${list.by || null}, ${list.byName || ''})
      ON CONFLICT (family_id) DO NOTHING`;
  }
  const hist = (await getStore('history').get(fam.id, { type: 'json' })) || [];
  for(const rec of hist){
    await insertPurchase(sql, fam.id, fam.region, rec);
  }
}
export async function insertPurchase(sql, familyId, region, rec){
  const items = rec.items || [];
  const store = rec.store || {};
  await sql`INSERT INTO purchases(id, family_id, date, duration_ms, total, items_count, bought_count, region, shopper_name, store_id, chain, record)
    VALUES(${rec.id}, ${familyId}, ${rec.date}, ${rec.durationMs || null}, ${rec.total || 0},
           ${items.length}, ${items.filter(i => i.bought).length}, ${region || 'אחר'},
           ${rec.shopperName || ''}, ${store.id || null}, ${store.chain || null}, ${JSON.stringify(rec)}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
}
export async function familyPayload(sql, familyId){
  const frows = await sql`SELECT id, code, name, region, admin_member_id, extract(epoch FROM created_at)*1000 AS created_at
    FROM families WHERE id = ${familyId}`;
  if(!frows.length) return null;
  const f = frows[0];
  const members = await sql`SELECT id, name, phone, extract(epoch FROM joined_at)*1000 AS joined_at
    FROM members WHERE family_id = ${familyId} ORDER BY joined_at`;
  return {
    id: f.id, code: f.code, name: f.name, region: f.region, createdAt: Number(f.created_at),
    adminMemberId: f.admin_member_id || null,
    members: members.map(m => ({ id: m.id, name: m.name, phone: m.phone, joinedAt: Number(m.joined_at) })),
  };
}
