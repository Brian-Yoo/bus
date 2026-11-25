import { searchStops } from '../lib/bus.js';
import { getQuery, handle } from '../lib/http.js';

// GET /api/search?q=강남역  → [{ arsId, name, lat, lng }]
export default async function handler(req, res) {
  const { q = '' } = getQuery(req);
  await handle(res, () => searchStops(q), 86400);
}
