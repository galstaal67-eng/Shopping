// API של מסך הניהול (admin.html) — נפרד מ-api.mjs, מוגן בסיסמה משותפת
// (משתנה סביבה ADMIN_PASSWORD ב-Netlify). כל בקשה חייבת לשאת את הסיסמה
// בכותרת x-admin-key. אם ADMIN_PASSWORD לא מוגדר בשרת — הכל נחסם (fail-closed).
import { getStore } from '@netlify/blobs';
import { json, uid, db, familyPayload, healBlobsFamilyAdmin } from './_shared.mjs';

function checkAuth(req){
  const want = process.env.ADMIN_PASSWORD;
  if(!want) return false;
  const got = req.headers.get('x-admin-key') || '';
  return got === want;
}

/* ---------- Blobs fallback helpers ---------- */
async function listFamiliesBlobs(){
  const store = getStore('families');
  const { blobs } = await store.list();
  const out = [];
  for(const b of blobs){
    const fam = await store.get(b.key, { type: 'json' });
    if(fam) out.push(fam);
  }
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const op = url.searchParams.get('op');

  if(!checkAuth(req)) return json({ ok: false, error: 'לא מורשה' }, 401);

  try {
    const sql = await db();

    if (req.method === 'POST') {
      const body = await req.json();

      if (op === 'updateFamily') {
        const familyId = String(body.familyId || '');
        const name = String(body.name || '').trim().slice(0, 60);
        const region = String(body.region || '').trim().slice(0, 30);
        if(!familyId || !name) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`UPDATE families SET name = ${name}, region = ${region} WHERE id = ${familyId}`;
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const store = getStore('families');
        const fam = await store.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
        fam.name = name; fam.region = region;
        await store.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'setFamilyAdmin') {
        const familyId = String(body.familyId || '');
        const memberId = String(body.memberId || '') || null;
        if(!familyId) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`UPDATE families SET admin_member_id = ${memberId} WHERE id = ${familyId}`;
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const store = getStore('families');
        const fam = await store.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
        fam.adminMemberId = memberId;
        await store.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'deleteFamily') {
        const familyId = String(body.familyId || '');
        if(!familyId) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`DELETE FROM families WHERE id = ${familyId}`;
          return json({ ok: true });
        }
        const famStore = getStore('families');
        const fam = await famStore.get(familyId, { type: 'json' });
        if(fam && fam.code) await getStore('codes').delete(fam.code);
        await famStore.delete(familyId);
        await getStore('lists').delete(familyId);
        await getStore('history').delete(familyId);
        return json({ ok: true });
      }

      if (op === 'updateMember') {
        const familyId = String(body.familyId || '');
        const memberId = String(body.memberId || '');
        const name = String(body.name || '').trim().slice(0, 40);
        const phone = String(body.phone || '').trim().slice(0, 20);
        if(!familyId || !memberId || !name) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`UPDATE members SET name = ${name}, phone = ${phone} WHERE id = ${memberId} AND family_id = ${familyId}`;
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const store = getStore('families');
        const fam = await store.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
        const m = (fam.members || []).find(x => x.id === memberId);
        if(!m) return json({ ok: false, error: 'חבר לא נמצא' }, 404);
        m.name = name; m.phone = phone;
        await store.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'deleteMember') {
        const familyId = String(body.familyId || '');
        const memberId = String(body.memberId || '');
        if(!familyId || !memberId) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`DELETE FROM members WHERE id = ${memberId} AND family_id = ${familyId}`;
          const frows = await sql`SELECT admin_member_id FROM families WHERE id = ${familyId}`;
          if(frows.length && frows[0].admin_member_id === memberId){
            await sql`UPDATE families SET admin_member_id = NULL WHERE id = ${familyId}`;
          }
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const store = getStore('families');
        const fam = await store.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
        fam.members = (fam.members || []).filter(m => m.id !== memberId);
        if(fam.adminMemberId === memberId) fam.adminMemberId = null;
        await store.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'addMember') {
        const familyId = String(body.familyId || '');
        const name = String(body.name || '').trim().slice(0, 40);
        const phone = String(body.phone || '').trim().slice(0, 20);
        if(!familyId || !name) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        const memberId = uid();
        if(sql){
          await sql`INSERT INTO members(id, family_id, name, phone) VALUES(${memberId}, ${familyId}, ${name}, ${phone})`;
          return json({ ok: true, family: await familyPayload(sql, familyId) });
        }
        const store = getStore('families');
        const fam = await store.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
        fam.members = fam.members || [];
        fam.members.push({ id: memberId, name, phone, joinedAt: Date.now() });
        await store.setJSON(familyId, fam);
        return json({ ok: true, family: fam });
      }

      if (op === 'updateFamilyList') {
        // עריכת קטגוריות/מוצרים של משפחה ספציפית — שומר את מערך ה-cats במלואו
        const familyId = String(body.familyId || '');
        const cats = body.cats;
        if(!familyId || !Array.isArray(cats)) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          const cur = await sql`SELECT data FROM lists WHERE family_id = ${familyId}`;
          const data = Object.assign({}, cur.length ? cur[0].data : {}, { cats });
          await sql`INSERT INTO lists(family_id, data, updated_at, updated_by, updated_by_name)
            VALUES(${familyId}, ${JSON.stringify(data)}::jsonb, ${Date.now()}, NULL, 'אדמין')
            ON CONFLICT (family_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at,
              updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`;
          return json({ ok: true });
        }
        const lists = getStore('lists');
        const cur = (await lists.get(familyId, { type: 'json' })) || { data: {} };
        cur.data = Object.assign({}, cur.data, { cats });
        cur.updatedAt = Date.now();
        cur.byName = 'אדמין';
        await lists.setJSON(familyId, cur);
        return json({ ok: true });
      }

      if (op === 'addStore') {
        const chain = String(body.chain || '').trim().slice(0, 40);
        const name = String(body.name || '').trim().slice(0, 60);
        const region = String(body.region || '').trim().slice(0, 30) || null;
        if(!chain || !name) return json({ ok: false, error: 'רשת ושם מקום חובה' }, 400);
        const id = uid();
        if(sql){
          const rows = await sql`INSERT INTO stores(id, chain, name, region, created_by)
            VALUES(${id}, ${chain}, ${name}, ${region}, 'אדמין')
            ON CONFLICT (chain, name) DO UPDATE SET region = EXCLUDED.region
            RETURNING id, chain, name, region`;
          return json({ ok: true, store: rows[0] });
        }
        const storesBlob = getStore('storesdb');
        const arr = (await storesBlob.get('all', { type: 'json' })) || [];
        let st = arr.find(s => s.chain === chain && s.name === name);
        if(st){ st.region = region; } else { st = { id, chain, name, region }; arr.push(st); }
        await storesBlob.setJSON('all', arr);
        return json({ ok: true, store: st });
      }

      if (op === 'updateStore') {
        const id = String(body.id || '');
        const chain = String(body.chain || '').trim().slice(0, 40);
        const name = String(body.name || '').trim().slice(0, 60);
        const region = String(body.region || '').trim().slice(0, 30) || null;
        if(!id || !chain || !name) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`UPDATE stores SET chain = ${chain}, name = ${name}, region = ${region} WHERE id = ${id}`;
          return json({ ok: true });
        }
        const storesBlob = getStore('storesdb');
        const arr = (await storesBlob.get('all', { type: 'json' })) || [];
        const st = arr.find(s => s.id === id);
        if(st){ st.chain = chain; st.name = name; st.region = region; await storesBlob.setJSON('all', arr); }
        return json({ ok: true });
      }

      if (op === 'deleteStore') {
        const id = String(body.id || '');
        if(!id) return json({ ok: false, error: 'חסרים נתונים' }, 400);
        if(sql){
          await sql`DELETE FROM stores WHERE id = ${id}`;
          return json({ ok: true });
        }
        const storesBlob = getStore('storesdb');
        const arr = ((await storesBlob.get('all', { type: 'json' })) || []).filter(s => s.id !== id);
        await storesBlob.setJSON('all', arr);
        return json({ ok: true });
      }

      if (op === 'addDeal' || op === 'updateDeal') {
        const emoji = String(body.emoji || '🏷️').slice(0, 8);
        const title = String(body.title || '').trim().slice(0, 80);
        const description = String(body.description || '').trim().slice(0, 200);
        const tag = String(body.tag || '').trim().slice(0, 30);
        const store = String(body.store || '').trim().slice(0, 60) || null;
        const region = String(body.region || '').trim().slice(0, 30) || null;
        const active = body.active !== false;
        if(!title) return json({ ok: false, error: 'כותרת חובה' }, 400);
        if(sql){
          if(op === 'addDeal'){
            const rows = await sql`INSERT INTO deals(store, region, emoji, title, description, tag, active)
              VALUES(${store}, ${region}, ${emoji}, ${title}, ${description}, ${tag}, ${active}) RETURNING id`;
            return json({ ok: true, id: rows[0].id });
          }
          const id = Number(body.id);
          if(!id) return json({ ok: false, error: 'חסר מזהה' }, 400);
          await sql`UPDATE deals SET store=${store}, region=${region}, emoji=${emoji}, title=${title},
            description=${description}, tag=${tag}, active=${active} WHERE id = ${id}`;
          return json({ ok: true });
        }
        return json({ ok: false, error: 'תכונת מבצעים דורשת חיבור DB' }, 400);
      }

      if (op === 'deleteDeal') {
        const id = Number(body.id);
        if(!id) return json({ ok: false, error: 'חסר מזהה' }, 400);
        if(sql){
          await sql`DELETE FROM deals WHERE id = ${id}`;
          return json({ ok: true });
        }
        return json({ ok: false, error: 'תכונת מבצעים דורשת חיבור DB' }, 400);
      }

    } else {
      if (op === 'ping') return json({ ok: true });

      if (op === 'stats') {
        if(sql){
          const [f, m, p] = await Promise.all([
            sql`SELECT count(*)::int AS n FROM families`,
            sql`SELECT count(*)::int AS n FROM members`,
            sql`SELECT count(*)::int AS n FROM purchases`,
          ]);
          return json({ ok: true, families: f[0].n, members: m[0].n, purchases: p[0].n, backend: 'postgres' });
        }
        const fams = await listFamiliesBlobs();
        return json({ ok: true, families: fams.length, members: fams.reduce((a, x) => a + (x.members || []).length, 0), purchases: null, backend: 'blobs' });
      }

      if (op === 'listFamilies') {
        if(sql){
          const rows = await sql`SELECT f.id, f.code, f.name, f.region, f.admin_member_id,
              extract(epoch FROM f.created_at)*1000 AS created_at, count(m.id)::int AS member_count
            FROM families f LEFT JOIN members m ON m.family_id = f.id
            GROUP BY f.id ORDER BY f.created_at DESC LIMIT 500`;
          return json({ ok: true, families: rows.map(r => ({
            id: r.id, code: r.code, name: r.name, region: r.region,
            adminMemberId: r.admin_member_id, createdAt: Number(r.created_at), memberCount: r.member_count,
          })) });
        }
        const fams = await listFamiliesBlobs();
        return json({ ok: true, families: fams.map(f => ({
          id: f.id, code: f.code, name: f.name, region: f.region,
          adminMemberId: f.adminMemberId || null, createdAt: f.createdAt || null, memberCount: (f.members || []).length,
        })) });
      }

      if (op === 'getFamilyDetail') {
        const familyId = url.searchParams.get('familyId');
        if(!familyId) return json({ ok: false, error: 'חסר מזהה' }, 400);
        if(sql){
          const fam = await familyPayload(sql, familyId);
          if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
          const listRows = await sql`SELECT data FROM lists WHERE family_id = ${familyId}`;
          return json({ ok: true, family: fam, cats: listRows.length ? (listRows[0].data.cats || []) : [] });
        }
        const store = getStore('families');
        const fam = await store.get(familyId, { type: 'json' });
        if(!fam) return json({ ok: false, error: 'לא נמצא' }, 404);
        const list = await getStore('lists').get(familyId, { type: 'json' });
        return json({ ok: true, family: await healBlobsFamilyAdmin(store, fam), cats: (list && list.data && list.data.cats) || [] });
      }

      if (op === 'listStores') {
        if(sql){
          const rows = await sql`SELECT id, chain, name, region FROM stores ORDER BY chain, name LIMIT 1000`;
          return json({ ok: true, stores: rows });
        }
        const arr = (await getStore('storesdb').get('all', { type: 'json' })) || [];
        return json({ ok: true, stores: arr });
      }

      if (op === 'listDeals') {
        if(sql){
          const rows = await sql`SELECT id, store, region, emoji, title, description, tag, active FROM deals ORDER BY created_at DESC LIMIT 500`;
          return json({ ok: true, deals: rows });
        }
        return json({ ok: true, deals: [] });
      }
    }
    return json({ ok: false, error: 'פעולה לא מוכרת' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: '/admin-api' };
