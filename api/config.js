import { isDemo } from '../lib/bus.js';
import { sendJson } from '../lib/http.js';

// GET /api/config → 화면에서 필요한 공개 설정
// 네이버 지도 Client ID는 원래 웹페이지에 노출되는 값 (네이버 클라우드에 등록한 사이트 주소에서만 동작)
export default function handler(req, res) {
  sendJson(res, 200, {
    naverMapClientId: (process.env.NAVER_MAP_CLIENT_ID || '').trim(),
    demo: isDemo(),
  });
}
