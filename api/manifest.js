import { iconIdFromBase } from '../lib/storage.js';
import { getQuery, sendJson } from '../lib/http.js';

// GET /api/manifest?img=<업로드한 아이콘 폴더 주소> → 내 사진 아이콘이 들어간 웹앱 manifest
// img가 없거나 잘못되면 기본 아이콘
export default function handler(req, res) {
  const { img } = getQuery(req);
  const icons = iconIdFromBase(img)
    ? [
        { src: `${img}/192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${img}/512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${img}/512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ]
    : [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ];
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  sendJson(res, 200, {
    id: '/',
    name: '버스 도착 알리미',
    short_name: '버스 도착',
    description: '정류소를 고르면 노선별로 1시간 안에 오는 버스를 보여줍니다.',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f5f9',
    theme_color: '#13804f',
    icons,
  }, 86400);
}
