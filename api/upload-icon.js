import { randomUUID } from 'node:crypto';
import { putIcon, deleteIcon, iconBase, iconIdFromBase, ICON_SIZES as SIZES } from '../lib/storage.js';
import { sendJson } from '../lib/http.js';

// POST /api/upload-icon
// body: { icons: { "512": "data:image/png;base64,...", "192": ..., "180": ... }, replace?: "<이전 아이콘 폴더 주소>" }
// → { base: "<아이콘 폴더 주소>" }   (base + "/512.png" 등으로 사용)
const MAX_BYTES = 900 * 1024;

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel이 이미 파싱
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 4 * 1024 * 1024) throw Object.assign(new Error('파일이 너무 큽니다.'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// PNG인지, 크기가 맞는지 확인
function checkPng(buf, size) {
  const sig = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!sig || buf.length > MAX_BYTES) return false;
  return buf.readUInt32BE(16) === size && buf.readUInt32BE(20) === size;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST만 가능합니다.' });
  try {
    const body = await readJson(req);
    const files = SIZES.map((size) => {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body?.icons?.[size] || '');
      const buf = m ? Buffer.from(m[1], 'base64') : null;
      if (!buf || !checkPng(buf, size)) throw Object.assign(new Error(`${size}px 아이콘 이미지가 올바르지 않습니다.`), { status: 400 });
      return { size, buf };
    });

    const id = randomUUID();
    await Promise.all(files.map((f) => putIcon(id, f.size, f.buf)));

    // 예전에 올린 아이콘은 지움 (실패해도 무시)
    const old = iconIdFromBase(body.replace);
    if (old) await deleteIcon(old).catch(() => {});
    const base = iconBase(id);
    sendJson(res, 200, { base });
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || '업로드 실패' });
  }
}
