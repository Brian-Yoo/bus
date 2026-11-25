import { readIcon } from '../lib/storage.js';
import { getQuery, sendJson } from '../lib/http.js';

// GET /icon-img/<id>/<크기>.png  (vercel.json에서 /api/icon-img?id=&size= 로 연결)
// 비공개 저장소에 있는 아이콘 사진을 읽어서 그대로 보여줌
export default async function handler(req, res) {
  const { id = '', size = '' } = getQuery(req);
  try {
    const buf = await readIcon(String(id), Number(size));
    if (!buf) return sendJson(res, 404, { error: '아이콘이 없습니다.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    // 같은 주소의 사진은 바뀌지 않음 (새로 저장하면 새 주소)
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.end(buf);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || '아이콘을 읽지 못했습니다.' });
  }
}
