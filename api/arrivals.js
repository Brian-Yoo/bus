import { getArrivals } from '../lib/bus.js';
import { getQuery, handle } from '../lib/http.js';

// GET /api/arrivals?stop=22009  (정류소 고유번호 arsId)
// 여러 사람이 같은 정류소를 봐도 15초 동안은 공공 API를 한 번만 부름 (하루 호출 한도 절약)
export default async function handler(req, res) {
  const { stop = '' } = getQuery(req);
  await handle(res, () => getArrivals(stop), 15);
}
