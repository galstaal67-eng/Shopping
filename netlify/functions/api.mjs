// שרת האפליקציה — Netlify Function יחידה.
//
// אחסון מרכזי: Netlify DB (Postgres של Neon) כשמופעל — סכמה רלציונית
// מלאה: families, members (ניידים לכל משפחה), sessions (נתוני התחברות),
// lists (הרשימה המסונכרנת), purchases (לוגי קניות לבנצ'מארק), deals
// (מבצעים — לחיבור חנויות בעתיד).
//
// כל עוד ה-DB לא הופעל (אין NETLIFY_DATABASE_URL) — נפילה אוטומטית
// ל-Netlify Blobs, ומשפחות קיימות עוברות ל-DB אוטומטית ברגע שיופעל.
import { getStore } from '@netlify/blobs';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ---------- Postgres (Netlify DB / Neon) ---------- */
let sqlClient = null;
let schemaReady = null;

async function db(){
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
async function ensureFamilyInDb(sql, familyId){
  const rows = await sql`SELECT id FROM families WHERE id = ${familyId}`;
  if(rows.length) return true;
  const fam = await getStore('families').get(familyId, { type: 'json' });
  if(!fam) return false;
  await migrateFamilyToDb(sql, fam);
  return true;
}
async function migrateFamilyToDb(sql, fam){
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
async function insertPurchase(sql, familyId, region, rec){
  const items = rec.items || [];
  await sql`INSERT INTO purchases(id, family_id, date, duration_ms, total, items_count, bought_count, region, shopper_name, record)
    VALUES(${rec.id}, ${familyId}, ${rec.date}, ${rec.durationMs || null}, ${rec.total || 0},
           ${items.length}, ${items.filter(i => i.bought).length}, ${region || 'אחר'},
           ${rec.shopperName || ''}, ${JSON.stringify(rec)}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
}
async function familyPayload(sql, familyId){
  const frows = await sql`SELECT id, code, name, region, extract(epoch FROM created_at)*1000 AS created_at
    FROM families WHERE id = ${familyId}`;
  if(!frows.length) return null;
  const f = frows[0];
  const members = await sql`SELECT id, name, phone, extract(epoch FROM joined_at)*1000 AS joined_at
    FROM members WHERE family_id = ${familyId} ORDER BY joined_at`;
  return {
    id: f.id, code: f.code, name: f.name, region: f.region, createdAt: Number(f.created_at),
    members: members.map(m => ({ id: m.id, name: m.name, phone: m.phone, joinedAt: Number(m.joined_at) })),
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const op = url.searchParams.get('op');
  const ua = (req.headers.get('user-agent') || '').slice(0, 200);

  try {
    const sql = await db();

    if (req.method === 'POST') {
      const body = await req.json();

      if (op === 'createFamily') {
        const familyId = uid();
        const memberId = uid();
        const name = String(body.familyName || 'המשפחה שלי').slice(0, 60);
        const region = String(body.region || 'אחר').slice(0, 30);
        const userName = String(body.userName || 'משתמש').slice(0, 40);
        const phone = String(body.phone || '').slice(0, 20);
        let code = newCode();
        if(sql){
          for(let i = 0; i < 8; i++){
            const dup = await sql`SELECT 1 FROM families WHERE code = ${code}`;
            if(!dup.length) break;
            code = newCode();
          }
          await sql`INSERT INTO families(id, code, name, region) VALUES(${familyId}, ${code}, ${name}, ${region})`;
          await sql`INSERT INTO members(id, family_id, name, phone) VALUES(${memberId}, ${familyId}, ${userName}, ${phone})`;
          await sql`INSERT INTO sessions(member_id, family_id, kind, user_agent) VALUES(${memberId}, ${familyId}, 'create', ${ua})`;
          return json({ ok: true, family: await familyPayload(sql, familyId), memberId });
        }
        // Blobs fallback
        const codes = getStore('codes');
        for(let i = 0; i < 8; i++){ if(!(await codes.get(code))) break; code = newCode(); }
        const member = { id: memberId, name: userName, phone, joinedAt: Date.now() };
        const fam = { id: familyId, code, name, region, members: [member], createdAt: Date.now() };
        await getStore('families').setJSON(familyId, fam);
        await codes.set(code, familyId);
        return json({ ok: true, family: fam, memberId });
      }

      if (op === 'joinFamily') {
        const code = String(body.code || '').toUpperCase().trim();
        const userName = String(body.userName || 'משתמש').slice(0, 40);
        const phone = String(body.phone || '').slice(0, 20);
        const memberId = uid();
        if(sql){
          let rows = await sql`SELECT id FROM families WHERE code = ${code}`;
          if(!rows.length){
            // אולי המשפחה עדיין ב-Blobs — מיגרציה
            const blobFamilyId = await getStore('codes').get(code);
            if(blobFamilyId && await ensureFamilyInDb(sql, blobFamilyId)) rows = [{ id: blobFamilyId }];
          }
          if(!rows.length) return json({ ok: false, error: 'קוד משפחה לא נמצא' }, 404);
          const familyId = rows[0].id;
          await sql`INSERT INTO members(id, family_id, name, phone) VALUES(${memberId}, ${familyId}, ${userName}, ${phone})`;
          await sql`INSERT INTO sessions(member_id, family_id, kind, user_agent) VALUES(${memberId}, ${familyId}, 'join', ${ua})`;
          return json({ ok: true, family: await familyPayload(sql, familyId), memberId });
        }
        const familyId = await getStore('codes').get(code);
        if(!familyId) return json({ ok: false, error: 'קוד משפחה לא נמצא' }, 404);
        const famStore = getStore('families');
        const fam = await famStore.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'המשפחה לא נמצאה' }, 404);
        fam.members.push({ id: memberId, name: userName, phone, joinedAt: Date.now() });
        if(fam.members.length > 20) fam.members.length = 20;
        await famStore.setJSON(familyId, fam);
        return json({ ok: true, family: fam, memberId });
      }

      if (op === 'putList') {
        if (!body.familyId) return json({ ok: false, error: 'familyId חסר' }, 400);
        if(sql){
          if(!(await ensureFamilyInDb(sql, body.familyId))) return json({ ok: false, error: 'משפחה לא נמצאה' }, 404);
          const cur = await sql`SELECT data, updated_at, updated_by, updated_by_name FROM lists WHERE family_id = ${body.familyId}`;
          if(cur.length && Number(cur[0].updated_at) > body.updatedAt){
            return json({ ok: true, stale: true, remote: {
              data: cur[0].data, updatedAt: Number(cur[0].updated_at),
              by: cur[0].updated_by, byName: cur[0].updated_by_name } });
          }
          await sql`INSERT INTO lists(family_id, data, updated_at, updated_by, updated_by_name)
            VALUES(${body.familyId}, ${JSON.stringify(body.data)}::jsonb, ${body.updatedAt || Date.now()}, ${body.memberId || null}, ${body.byName || ''})
            ON CONFLICT (family_id) DO UPDATE SET
              data = EXCLUDED.data, updated_at = EXCLUDED.updated_at,
              updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`;
          if(body.memberId) await sql`UPDATE sessions SET last_seen = now() WHERE member_id = ${body.memberId}`;
          return json({ ok: true });
        }
        const lists = getStore('lists');
        const cur = await lists.get(body.familyId, { type: 'json' });
        if (cur && cur.updatedAt > body.updatedAt) return json({ ok: true, stale: true, remote: cur });
        await lists.setJSON(body.familyId, {
          data: body.data, updatedAt: body.updatedAt || Date.now(),
          by: body.memberId || null, byName: body.byName || '',
        });
        return json({ ok: true });
      }

      if (op === 'finishTrip') {
        if (!body.familyId || !body.record) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          if(!(await ensureFamilyInDb(sql, body.familyId))) return json({ ok: false, error: 'משפחה לא נמצאה' }, 404);
          await insertPurchase(sql, body.familyId, body.region, body.record);
          return json({ ok: true });
        }
        const history = getStore('history');
        const arr = (await history.get(body.familyId, { type: 'json' })) || [];
        if (!arr.some(r => r.id === body.record.id)) arr.unshift(body.record);
        if (arr.length > 100) arr.length = 100;
        await history.setJSON(body.familyId, arr);
        if (body.region) {
          const stats = getStore('stats');
          const key = 'r_' + body.region;
          const s = (await stats.get(key, { type: 'json' })) || [];
          s.unshift({
            total: body.record.total || 0,
            items: (body.record.items || []).length,
            bought: (body.record.items || []).filter(i => i.bought).length,
            durationMs: body.record.durationMs || null,
            date: body.record.date,
          });
          if (s.length > 500) s.length = 500;
          await stats.setJSON(key, s);
        }
        return json({ ok: true });
      }
    } else {
      if (op === 'getFamily') {
        const familyId = url.searchParams.get('familyId');
        if(sql){
          if(!(await ensureFamilyInDb(sql, familyId))) return json({ ok: false, error: 'לא נמצא' }, 404);
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const fam = await getStore('families').get(familyId, { type: 'json' });
        return fam ? json({ ok: true, family: fam }) : json({ ok: false, error: 'לא נמצא' }, 404);
      }

      if (op === 'getList') {
        const familyId = url.searchParams.get('familyId');
        if(sql){
          if(!(await ensureFamilyInDb(sql, familyId))) return json({ ok: true, list: null });
          const rows = await sql`SELECT data, updated_at, updated_by, updated_by_name FROM lists WHERE family_id = ${familyId}`;
          return json({ ok: true, list: rows.length ? {
            data: rows[0].data, updatedAt: Number(rows[0].updated_at),
            by: rows[0].updated_by, byName: rows[0].updated_by_name } : null });
        }
        const l = await getStore('lists').get(familyId, { type: 'json' });
        return json({ ok: true, list: l || null });
      }

      if (op === 'getHistory') {
        const familyId = url.searchParams.get('familyId');
        if(sql){
          if(!(await ensureFamilyInDb(sql, familyId))) return json({ ok: true, history: [] });
          const rows = await sql`SELECT record FROM purchases WHERE family_id = ${familyId} ORDER BY date DESC LIMIT 100`;
          return json({ ok: true, history: rows.map(r => r.record) });
        }
        const h = await getStore('history').get(familyId, { type: 'json' });
        return json({ ok: true, history: h || [] });
      }

      if (op === 'benchmark') {
        const region = url.searchParams.get('region') || 'אחר';
        if(sql){
          const rows = await sql`SELECT count(*)::int AS count,
              avg(total) AS avg_total,
              avg(items_count) AS avg_items,
              avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS avg_duration
            FROM purchases WHERE region = ${region}`;
          const r = rows[0];
          return json({ ok: true, region, count: r.count,
            avgTotal: r.avg_total ? Number(r.avg_total) : 0,
            avgItems: r.avg_items ? Number(r.avg_items) : 0,
            avgDurationMs: r.avg_duration ? Number(r.avg_duration) : null });
        }
        const s = (await getStore('stats').get('r_' + region, { type: 'json' })) || [];
        const n = s.length;
        const avg = f => (n ? s.reduce((a, x) => a + (f(x) || 0), 0) / n : 0);
        const withDur = s.filter(x => x.durationMs);
        return json({
          ok: true, region, count: n,
          avgTotal: avg(x => x.total),
          avgItems: avg(x => x.items),
          avgDurationMs: withDur.length ? withDur.reduce((a, x) => a + x.durationMs, 0) / withDur.length : null,
        });
      }

      if (op === 'getDeals') {
        const region = url.searchParams.get('region') || null;
        if(sql){
          const rows = region
            ? await sql`SELECT emoji, title, description, tag, store FROM deals
                WHERE active AND (region IS NULL OR region = ${region}) ORDER BY created_at DESC LIMIT 12`
            : await sql`SELECT emoji, title, description, tag, store FROM deals
                WHERE active ORDER BY created_at DESC LIMIT 12`;
          return json({ ok: true, deals: rows });
        }
        return json({ ok: true, deals: [] });
      }

      if (op === 'status') {
        return json({ ok: true, db: !!sql, time: Date.now() });
      }
    }
    return json({ ok: false, error: 'פעולה לא מוכרת' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: '/api' };
