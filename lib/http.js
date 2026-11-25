// Vercel 서버리스 함수와 로컬 서버(server.js)에서 같이 쓰는 응답 헬퍼
export function sendJson(res, status, body, cacheSec = 0) {
  res.statusCode = status;
  if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSec ? `public, s-maxage=${cacheSec}, max-age=${cacheSec}` : 'no-store');
  res.end(JSON.stringify(body));
}

export function getQuery(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, 'http://localhost');
  return Object.fromEntries(u.searchParams);
}

export async function handle(res, fn, cacheSec) {
  try {
    sendJson(res, 200, await fn(), cacheSec);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || '알 수 없는 오류' });
  }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
