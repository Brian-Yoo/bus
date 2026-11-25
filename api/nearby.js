import { nearbyStops } from '../lib/bus.js';
import { getQuery, handle } from '../lib/http.js';

// GET /api/nearby?lat=37.49&lng=127.02&radius=500  → [{ arsId, name, lat, lng, dist }]
// 정류소 위치는 잘 안 바뀌므로 하루 캐시 (화면에서 좌표를 약 100m 단위로 반올림해서 부름)
export default async function handler(req, res) {
  const { lat, lng, radius } = getQuery(req);
  await handle(res, () => nearbyStops(lat, lng, radius), 86400);
}
