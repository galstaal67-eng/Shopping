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
/* מנרמל מספר טלפון להשוואה (תואם ל-normPhone בצד הלקוח) — כדי לזהות חבר קיים לפי הנייד */
function normPhone(p){
  let d = String(p || '').replace(/\D/g, '');
  if(d.startsWith('00')) d = d.slice(2);
  if(d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}

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
  const store = rec.store || {};
  await sql`INSERT INTO purchases(id, family_id, date, duration_ms, total, items_count, bought_count, region, shopper_name, store_id, chain, record)
    VALUES(${rec.id}, ${familyId}, ${rec.date}, ${rec.durationMs || null}, ${rec.total || 0},
           ${items.length}, ${items.filter(i => i.bought).length}, ${region || 'אחר'},
           ${rec.shopperName || ''}, ${store.id || null}, ${store.chain || null}, ${JSON.stringify(rec)}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
}
async function familyPayload(sql, familyId){
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
        const normedPhone = normPhone(phone);
        if(sql){
          let rows = await sql`SELECT id FROM families WHERE code = ${code}`;
          if(!rows.length){
            // אולי המשפחה עדיין ב-Blobs — מיגרציה
            const blobFamilyId = await getStore('codes').get(code);
            if(blobFamilyId && await ensureFamilyInDb(sql, blobFamilyId)) rows = [{ id: blobFamilyId }];
          }
          if(!rows.length) return json({ ok: false, error: 'קוד משפחה לא נמצא' }, 404);
          const familyId = rows[0].id;
          // חבר קיים עם אותו נייד — מתחברים אליו מחדש במקום ליצור כפילות
          let memberId = null;
          if(normedPhone){
            const existing = await sql`SELECT id, phone FROM members WHERE family_id = ${familyId}`;
            const match = existing.find(m => normPhone(m.phone) === normedPhone);
            if(match) memberId = match.id;
          }
          if(memberId){
            await sql`UPDATE members SET name = ${userName} WHERE id = ${memberId}`;
          }else{
            memberId = uid();
            await sql`INSERT INTO members(id, family_id, name, phone) VALUES(${memberId}, ${familyId}, ${userName}, ${phone})`;
          }
          await sql`INSERT INTO sessions(member_id, family_id, kind, user_agent) VALUES(${memberId}, ${familyId}, 'join', ${ua})`;
          return json({ ok: true, family: await familyPayload(sql, familyId), memberId });
        }
        const familyId = await getStore('codes').get(code);
        if(!familyId) return json({ ok: false, error: 'קוד משפחה לא נמצא' }, 404);
        const famStore = getStore('families');
        const fam = await famStore.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'המשפחה לא נמצאה' }, 404);
        let memberId = null;
        if(normedPhone){
          const match = (fam.members || []).find(m => normPhone(m.phone) === normedPhone);
          if(match) memberId = match.id;
        }
        if(memberId){
          const m = fam.members.find(x => x.id === memberId);
          m.name = userName;
        }else{
          memberId = uid();
          fam.members.push({ id: memberId, name: userName, phone, joinedAt: Date.now() });
          if(fam.members.length > 20) fam.members.length = 20;
        }
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
        const stats = getStore('stats');
        const summary = {
          total: body.record.total || 0,
          items: (body.record.items || []).length,
          bought: (body.record.items || []).filter(i => i.bought).length,
          durationMs: body.record.durationMs || null,
          date: body.record.date,
        };
        const appendStat = async (key) => {
          const s = (await stats.get(key, { type: 'json' })) || [];
          s.unshift(summary);
          if (s.length > 500) s.length = 500;
          await stats.setJSON(key, s);
        };
        if (body.region) await appendStat('r_' + body.region);
        const chain = body.record.store && body.record.store.chain;
        if (chain) {
          await appendStat('c_' + chain);
          const idx = (await stats.get('chains', { type: 'json' })) || [];
          if(!idx.includes(chain)){ idx.push(chain); await stats.setJSON('chains', idx); }
        }
        return json({ ok: true });
      }

      if (op === 'addStore') {
        const chain = String(body.chain || '').trim().slice(0, 40);
        const name = String(body.name || '').trim().slice(0, 60);
        if(!chain || !name) return json({ ok: false, error: 'רשת ושם מקום חובה' }, 400);
        const region = String(body.region || '').slice(0, 30) || null;
        const id = uid();
        if(sql){
          const rows = await sql`INSERT INTO stores(id, chain, name, region, created_by)
            VALUES(${id}, ${chain}, ${name}, ${region}, ${String(body.by || '').slice(0, 40)})
            ON CONFLICT (chain, name) DO UPDATE SET region = COALESCE(stores.region, EXCLUDED.region)
            RETURNING id, chain, name, region`;
          return json({ ok: true, store: rows[0] });
        }
        const storesBlob = getStore('storesdb');
        const arr = (await storesBlob.get('all', { type: 'json' })) || [];
        let st = arr.find(s => s.chain === chain && s.name === name);
        if(!st){
          st = { id, chain, name, region };
          arr.push(st);
          if(arr.length > 500) arr.length = 500;
          await storesBlob.setJSON('all', arr);
        }
        return json({ ok: true, store: st });
      }

      if (op === 'claimAdmin') {
        const familyId = String(body.familyId || '');
        const memberId = String(body.memberId || '');
        if(!familyId || !memberId) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          if(!(await ensureFamilyInDb(sql, familyId))) return json({ ok: false, error: 'משפחה לא נמצאה' }, 404);
          const rows = await sql`UPDATE families SET admin_member_id = ${memberId}
            WHERE id = ${familyId} AND admin_member_id IS NULL RETURNING admin_member_id`;
          if(!rows.length) return json({ ok: false, error: 'כבר יש מנהל למשפחה' }, 409);
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const famStore = getStore('families');
        const fam = await famStore.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'המשפחה לא נמצאה' }, 404);
        if(fam.adminMemberId) return json({ ok: false, error: 'כבר יש מנהל למשפחה' }, 409);
        fam.adminMemberId = memberId;
        await famStore.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'removeMember') {
        const familyId = String(body.familyId || '');
        const memberId = String(body.memberId || '');
        const targetId = String(body.targetId || '');
        if(!familyId || !memberId || !targetId) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(targetId === memberId) return json({ ok: false, error: 'אי אפשר להסיר את עצמך' }, 400);
        if(sql){
          if(!(await ensureFamilyInDb(sql, familyId))) return json({ ok: false, error: 'משפחה לא נמצאה' }, 404);
          const frows = await sql`SELECT admin_member_id FROM families WHERE id = ${familyId}`;
          if(!frows.length || frows[0].admin_member_id !== memberId) return json({ ok: false, error: 'רק המנהל יכול להסיר חברים' }, 403);
          await sql`DELETE FROM members WHERE id = ${targetId} AND family_id = ${familyId}`;
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const famStore = getStore('families');
        const fam = await famStore.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'המשפחה לא נמצאה' }, 404);
        if(fam.adminMemberId !== memberId) return json({ ok: false, error: 'רק המנהל יכול להסיר חברים' }, 403);
        fam.members = (fam.members || []).filter(m => m.id !== targetId);
        await famStore.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'mergeDuplicateMembers') {
        // מאחד חברים כפולים שנוצרו לפני תיקון ה-dedup (אותו נייד, כמה רשומות) לרשומה אחת
        const familyId = String(body.familyId || '');
        const memberId = String(body.memberId || '');
        if(!familyId || !memberId) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        const pickCanonical = (group, adminId) =>
          group.find(m => m.id === memberId) || group.find(m => m.id === adminId) || group[0];
        if(sql){
          if(!(await ensureFamilyInDb(sql, familyId))) return json({ ok: false, error: 'משפחה לא נמצאה' }, 404);
          const frows = await sql`SELECT admin_member_id FROM families WHERE id = ${familyId}`;
          if(!frows.length || frows[0].admin_member_id !== memberId) return json({ ok: false, error: 'רק המנהל יכול לאחד כפילויות' }, 403);
          let adminId = frows[0].admin_member_id;
          const members = await sql`SELECT id, name, phone, extract(epoch FROM joined_at)*1000 AS joined_at
            FROM members WHERE family_id = ${familyId} ORDER BY joined_at`;
          const groups = new Map();
          for(const m of members){
            const key = normPhone(m.phone);
            if(!key) continue;
            if(!groups.has(key)) groups.set(key, []);
            groups.get(key).push(m);
          }
          let removed = 0;
          for(const group of groups.values()){
            if(group.length < 2) continue;
            const canonical = pickCanonical(group, adminId);
            const latestName = group[group.length - 1].name;
            if(latestName && latestName !== canonical.name){
              await sql`UPDATE members SET name = ${latestName} WHERE id = ${canonical.id}`;
            }
            for(const m of group){
              if(m.id === canonical.id) continue;
              await sql`DELETE FROM members WHERE id = ${m.id}`;
              removed++;
              if(adminId === m.id) adminId = canonical.id;
            }
          }
          if(adminId !== frows[0].admin_member_id){
            await sql`UPDATE families SET admin_member_id = ${adminId} WHERE id = ${familyId}`;
          }
          return json({ ok: true, removed, family: await familyPayload(sql, familyId) });
        }
        const famStore = getStore('families');
        const fam = await famStore.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'המשפחה לא נמצאה' }, 404);
        if(fam.adminMemberId !== memberId) return json({ ok: false, error: 'רק המנהל יכול לאחד כפילויות' }, 403);
        const groups = new Map();
        for(const m of (fam.members || [])){
          const key = normPhone(m.phone);
          if(!key) continue;
          (groups.get(key) || groups.set(key, []).get(key)).push(m);
        }
        let removed = 0;
        let adminId = fam.adminMemberId;
        const toRemove = new Set();
        for(const group of groups.values()){
          if(group.length < 2) continue;
          const canonical = pickCanonical(group, adminId);
          const latest = group[group.length - 1];
          if(latest.name && latest.name !== canonical.name) canonical.name = latest.name;
          for(const m of group){
            if(m.id === canonical.id) continue;
            toRemove.add(m.id);
            removed++;
            if(adminId === m.id) adminId = canonical.id;
          }
        }
        fam.members = fam.members.filter(m => !toRemove.has(m.id));
        fam.adminMemberId = adminId;
        await famStore.setJSON(familyId, fam);
        return json({ ok: true, removed, family: fam });
      }
    } else {
      if (op === 'getStores') {
        const q = (url.searchParams.get('q') || '').trim();
        if(sql){
          const rows = q
            ? await sql`SELECT id, chain, name, region FROM stores
                WHERE (chain || ' ' || name) ILIKE ${'%' + q + '%'} ORDER BY chain, name LIMIT 100`
            : await sql`SELECT id, chain, name, region FROM stores ORDER BY chain, name LIMIT 100`;
          return json({ ok: true, stores: rows });
        }
        let arr = (await getStore('storesdb').get('all', { type: 'json' })) || [];
        if(q) arr = arr.filter(s => (s.chain + ' ' + s.name).includes(q));
        return json({ ok: true, stores: arr.slice(0, 100) });
      }

      if (op === 'benchmarkChains') {
        if(sql){
          const rows = await sql`SELECT chain, count(*)::int AS count,
              avg(total) AS avg_total,
              avg(items_count) AS avg_items,
              avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS avg_duration
            FROM purchases WHERE chain IS NOT NULL AND chain <> ''
            GROUP BY chain ORDER BY count DESC LIMIT 10`;
          return json({ ok: true, chains: rows.map(r => ({
            chain: r.chain, count: r.count,
            avgTotal: r.avg_total ? Number(r.avg_total) : 0,
            avgItems: r.avg_items ? Number(r.avg_items) : 0,
            avgDurationMs: r.avg_duration ? Number(r.avg_duration) : null })) });
        }
        const stats = getStore('stats');
        const idx = (await stats.get('chains', { type: 'json' })) || [];
        const chains = [];
        for(const chain of idx.slice(0, 10)){
          const s = (await stats.get('c_' + chain, { type: 'json' })) || [];
          const n = s.length;
          if(!n) continue;
          const avg = f => s.reduce((a, x) => a + (f(x) || 0), 0) / n;
          const withDur = s.filter(x => x.durationMs);
          chains.push({ chain, count: n, avgTotal: avg(x => x.total), avgItems: avg(x => x.items),
            avgDurationMs: withDur.length ? withDur.reduce((a, x) => a + x.durationMs, 0) / withDur.length : null });
        }
        chains.sort((a, b) => b.count - a.count);
        return json({ ok: true, chains });
      }
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
