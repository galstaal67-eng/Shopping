// שרת האפליקציה — Netlify Function יחידה מעל Netlify Blobs.
// אחסון: families (פרטי משפחה וחברים), codes (קוד הצטרפות → משפחה),
// lists (הרשימה המסונכרנת), history (קניות שהסתיימו), stats (נתונים
// אנונימיים להשוואה אזורית — מספרים בלבד, בלי זיהוי משפחה).
import { getStore } from '@netlify/blobs';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export default async (req) => {
  const url = new URL(req.url);
  const op = url.searchParams.get('op');
  const families = getStore('families');
  const codes = getStore('codes');
  const lists = getStore('lists');
  const history = getStore('history');
  const stats = getStore('stats');

  try {
    if (req.method === 'POST') {
      const body = await req.json();

      if (op === 'createFamily') {
        const familyId = uid();
        let code = newCode();
        for (let i = 0; i < 8; i++) {
          if (!(await codes.get(code))) break;
          code = newCode();
        }
        const member = { id: uid(), name: String(body.userName || 'משתמש').slice(0, 40), phone: String(body.phone || '').slice(0, 20) };
        const fam = {
          id: familyId, code,
          name: String(body.familyName || 'המשפחה שלי').slice(0, 60),
          region: String(body.region || 'אחר').slice(0, 30),
          members: [member], createdAt: Date.now(),
        };
        await families.setJSON(familyId, fam);
        await codes.set(code, familyId);
        return json({ ok: true, family: fam, memberId: member.id });
      }

      if (op === 'joinFamily') {
        const code = String(body.code || '').toUpperCase().trim();
        const familyId = await codes.get(code);
        if (!familyId) return json({ ok: false, error: 'קוד משפחה לא נמצא' }, 404);
        const fam = await families.get(familyId, { type: 'json' });
        if (!fam) return json({ ok: false, error: 'המשפחה לא נמצאה' }, 404);
        const member = { id: uid(), name: String(body.userName || 'משתמש').slice(0, 40), phone: String(body.phone || '').slice(0, 20) };
        fam.members.push(member);
        if (fam.members.length > 20) fam.members.length = 20;
        await families.setJSON(familyId, fam);
        return json({ ok: true, family: fam, memberId: member.id });
      }

      if (op === 'putList') {
        if (!body.familyId) return json({ ok: false, error: 'familyId חסר' }, 400);
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
        const arr = (await history.get(body.familyId, { type: 'json' })) || [];
        if (!arr.some(r => r.id === body.record.id)) arr.unshift(body.record);
        if (arr.length > 100) arr.length = 100;
        await history.setJSON(body.familyId, arr);
        if (body.region) {
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
        const fam = await families.get(url.searchParams.get('familyId'), { type: 'json' });
        return fam ? json({ ok: true, family: fam }) : json({ ok: false, error: 'לא נמצא' }, 404);
      }
      if (op === 'getList') {
        const l = await lists.get(url.searchParams.get('familyId'), { type: 'json' });
        return json({ ok: true, list: l || null });
      }
      if (op === 'getHistory') {
        const h = await history.get(url.searchParams.get('familyId'), { type: 'json' });
        return json({ ok: true, history: h || [] });
      }
      if (op === 'benchmark') {
        const region = url.searchParams.get('region') || 'אחר';
        const s = (await stats.get('r_' + region, { type: 'json' })) || [];
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
    }
    return json({ ok: false, error: 'פעולה לא מוכרת' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: '/api' };
