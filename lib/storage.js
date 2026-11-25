// 사진 아이콘 저장소
// - 배포(Vercel): Vercel Blob (비공개 저장소). 사진은 /icon-img/<id>/<크기>.png 주소로 이 앱이 대신 읽어서 보여줌
// - 로컬 개발(server.js): .local-uploads 폴더
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';

const LOCAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.local-uploads');

// 연결 방식: 예전 방식(*_READ_WRITE_TOKEN) 또는 새 방식(BLOB_STORE_ID + Vercel 자동 인증)
function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith('READ_WRITE_TOKEN') && String(v).startsWith('vercel_blob_rw_')) return v;
  }
  return '';
}
const auth = () => { const t = blobToken(); return t ? { token: t } : {}; };
const hasBlob = () => !!blobToken() || !!process.env.BLOB_STORE_ID;
const useLocal = () => !hasBlob() && process.env.LOCAL_DEV === '1';
// 저장소를 만들 때 공개/비공개를 고르는데, 기본은 비공개. 공개 저장소면 BLOB_ACCESS=public
const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

function needBlob() {
  if (hasBlob()) return;
  const seen = Object.keys(process.env).filter((k) => /BLOB/i.test(k));
  throw new HttpError(500, '사진 저장소(Vercel Blob)가 아직 연결되지 않았습니다. 이 배포에 보이는 관련 변수: ' + (seen.join(', ') || '없음'));
}

const ID = /^[0-9a-f-]{36}$/;
export const ICON_SIZES = [512, 192, 180];
const iconPath = (id, size) => `icons/${id}/${size}.png`;
export const iconBase = (id) => `/icon-img/${id}`;

export async function putIcon(id, size, buffer) {
  const name = iconPath(id, size);
  if (useLocal()) {
    const file = path.join(LOCAL_DIR, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return;
  }
  needBlob();
  const { put } = await import('@vercel/blob');
  await put(name, buffer, {
    access: ACCESS,
    contentType: 'image/png',
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
    ...auth(),
  });
}

// 아이콘 PNG 읽기 → Buffer 또는 null
export async function readIcon(id, size) {
  if (!ID.test(id) || !ICON_SIZES.includes(size)) return null;
  const name = iconPath(id, size);
  if (useLocal()) {
    const file = path.join(LOCAL_DIR, name);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  needBlob();
  const { get } = await import('@vercel/blob');
  const r = await get(name, { access: ACCESS, ...auth() }).catch((e) => {
    if (e?.name === 'BlobNotFoundError') return null;
    throw e;
  });
  if (!r || r.statusCode !== 200) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}

export async function deleteIcon(id) {
  if (!ID.test(id)) return;
  const names = ICON_SIZES.map((s) => iconPath(id, s));
  if (useLocal()) {
    for (const n of names) fs.rmSync(path.join(LOCAL_DIR, n), { force: true });
    return;
  }
  if (!hasBlob()) return;
  const { del } = await import('@vercel/blob');
  await del(names, auth());
}

// 아이콘 폴더 주소(/icon-img/<id>)에서 id 꺼내기. 잘못된 주소면 null
export function iconIdFromBase(base) {
  const m = typeof base === 'string' && /^\/icon-img\/([0-9a-f-]{36})$/.exec(base);
  return m ? m[1] : null;
}
