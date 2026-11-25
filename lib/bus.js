// 서울 버스 공공 API (공공데이터포털 "서울특별시_정류소정보조회 서비스", ws.bus.go.kr)
// - 정류소 이름 검색: stationinfo/getStationByName
// - 주변 정류소:      stationinfo/getStationByPos
// - 정류소 도착정보:   stationinfo/getStationByUid (정류소 고유번호 arsId, 5자리)
// BUS_API_KEY가 없거나 'sample'이면 예시 데이터(lib/mock.js)로 동작 → 화면 개발·시연용
import { HttpError } from './http.js';
import * as mock from './mock.js';

const BASE = 'http://ws.bus.go.kr/api/rest/stationinfo';
export const WINDOW_MIN = 60;

const apiKey = () => (process.env.BUS_API_KEY || '').trim();
export const isDemo = () => !apiKey() || apiKey() === 'sample';

// 공공데이터포털 키는 Encoding(이미 %로 인코딩됨) / Decoding(원본) 두 가지 → 이중 인코딩 방지
function keyParam() {
  const k = apiKey();
  return /%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k);
}

async function call(op, params) {
  const qs = Object.entries({ ...params, resultType: 'json' })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${BASE}/${op}?serviceKey=${keyParam()}&${qs}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new HttpError(502, `버스 정보 서버에 연결하지 못했습니다. (${e.name === 'TimeoutError' ? '시간 초과' : e.message})`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch {
    // 키 오류 등은 공공데이터포털이 XML로 돌려줌
    const msg = /<returnAuthMsg>([^<]+)/.exec(text)?.[1] || /<errMsg>([^<]+)/.exec(text)?.[1] ||
      /<headerMsg>([^<]+)/.exec(text)?.[1] || `응답 오류 ${res.status}`;
    throw new HttpError(502, keyHint(msg));
  }
  const h = body.msgHeader || {};
  const cd = String(h.headerCd ?? '0');
  if (cd === '4') return []; // 결과 없음
  if (cd !== '0') throw new HttpError(502, keyHint(h.headerMsg || `오류 코드 ${cd}`));
  const list = body.msgBody?.itemList;
  return Array.isArray(list) ? list : list ? [list] : [];
}

function keyHint(msg) {
  if (/SERVICE_KEY|등록되지 않은|인증|key/i.test(msg)) {
    return `인증키 오류: ${msg} (공공데이터포털에서 '서울특별시_정류소정보조회 서비스' 활용신청 후 1~2시간 뒤부터 사용 가능)`;
  }
  if (/LIMITED|초과/i.test(msg)) return `오늘 조회 한도를 넘었습니다: ${msg}`;
  return msg;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const validArs = (a) => /^\d{5}$/.test(String(a || ''));

// ---------- 정류소 검색 ----------
export async function searchStops(q) {
  q = String(q || '').trim();
  if (!q) return [];
  // 정류소 번호(5자리)로 검색 → 도착정보에서 이름을 알아냄
  if (validArs(q)) {
    const items = isDemo() ? mock.arrivalItems(q) : await call('getStationByUid', { arsId: q });
    return items.length ? [{ arsId: q, name: items[0].stNm || `정류소 ${q}`, lat: null, lng: null }] : [];
  }
  if (isDemo()) return mock.searchStops(q);
  const items = await call('getStationByName', { stSrch: q });
  const list = items
    .filter((s) => validArs(s.arsId))
    .map((s) => ({ arsId: s.arsId, name: s.stNm, lat: num(s.tmY), lng: num(s.tmX) }));
  // 정확히 같은 이름 → 이름이 앞에서 일치 → 나머지
  const rank = (s) => (s.name === q ? 0 : s.name.startsWith(q) ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko') || a.arsId.localeCompare(b.arsId));
  return list.slice(0, 40);
}

// ---------- 주변 정류소 (지도) ----------
export async function nearbyStops(lat, lng, radius = 500) {
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39 || lng < 124 || lng > 132) {
    throw new HttpError(400, '위치 값이 올바르지 않습니다.');
  }
  radius = Math.min(1500, Math.max(100, Number(radius) || 500));
  if (isDemo()) return mock.nearbyStops(lat, lng, radius);
  const items = await call('getStationByPos', { tmX: lng.toFixed(6), tmY: lat.toFixed(6), radius });
  return items
    .filter((s) => validArs(s.arsId))
    .map((s) => ({ arsId: s.arsId, name: s.stationNm, lat: num(s.gpsY), lng: num(s.gpsX), dist: num(s.dist) }))
    .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))
    .slice(0, 60);
}

// ---------- 도착정보 ----------
// 노선 유형: 공공 API routeType 코드 → 이름, 색 (서울 버스 색 기준)
const ROUTE_TYPES = {
  1: ['공항', '#a0855b'], 2: ['마을', '#53b332'], 3: ['간선', '#3d5bab'], 4: ['지선', '#4cae3f'],
  5: ['순환', '#f2b70a'], 6: ['광역', '#e60012'], 7: ['인천', '#3d5bab'], 8: ['경기', '#3d5bab'],
  0: ['공용', '#8a8f98'], 14: ['한강', '#2c88c8'], 15: ['심야', '#1b2a4a'],
};
export function routeStyle(type, name = '') {
  if (/^N\d/i.test(name)) return { type: '심야', color: '#1b2a4a' };
  const [t, c] = ROUTE_TYPES[Number(type)] || ['기타', '#6b7280'];
  return { type: t, color: c };
}

// "5분12초후[3번째 전]" / "곧 도착" / "운행종료" 등 → { etaSec, stops, status }
export function parseArrival(msg, traTime) {
  msg = String(msg || '').trim();
  const stops = Number(/\[(\d+)번째 전\]/.exec(msg)?.[1]) || null;
  if (!msg || /운행종료|출발대기|회차대기|운행대기|정보없음|도착정보 없음/.test(msg)) {
    return { etaSec: null, stops: null, status: msg || '정보 없음' };
  }
  if (/곧 도착|도착/.test(msg) && !/후/.test(msg)) return { etaSec: 0, stops, status: '' };
  let sec = num(traTime);
  if (!sec) {
    const m = /(?:(\d+)분)?\s*(?:(\d+)초)?\s*후/.exec(msg);
    if (m && (m[1] || m[2])) sec = Number(m[1] || 0) * 60 + Number(m[2] || 0);
  }
  return sec == null ? { etaSec: null, stops, status: msg } : { etaSec: sec, stops, status: '' };
}

// "2026-11-25 17:20:31.0" (한국 시간) → epoch ms
function kstTime(s) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]);
}

const CONGESTION = { 3: '여유', 4: '보통', 5: '혼잡', 6: '매우혼잡' };

function busOf(r, i) {
  const a = parseArrival(r[`arrmsg${i}`], r[`traTime${i}`]);
  const div = String(r[`rerdie_Div${i}`] ?? r[`reride_Div${i}`] ?? '');
  const ride = num(r[`reride_Num${i}`]);
  let crowd = '';
  if (div === '4' && CONGESTION[ride]) crowd = CONGESTION[ride];
  else if (r[`congestion${i}`] && CONGESTION[num(r[`congestion${i}`])]) crowd = CONGESTION[num(r[`congestion${i}`])];
  return {
    ...a,
    position: r[`stationNm${i}`] || '',
    plate: r[`plainNo${i}`] || '',
    lowFloor: String(r[`busType${i}`]) === '1',
    last: String(r[`isLast${i}`]) === '1',
    full: String(r[`isFullFlag${i}`]) === '1',
    crowd,
  };
}

// 가장 많이 나오는 "다음 정류장" = 이 정류소의 진행 방향
function mainDirection(items) {
  const cnt = new Map();
  for (const r of items) if (r.nxtStn) cnt.set(r.nxtStn, (cnt.get(r.nxtStn) || 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export async function getArrivals(arsId) {
  arsId = String(arsId || '').trim();
  if (!validArs(arsId)) throw new HttpError(400, '정류소 번호(5자리)가 올바르지 않습니다.');
  const items = isDemo() ? mock.arrivalItems(arsId) : await call('getStationByUid', { arsId });
  if (!items.length) throw new HttpError(404, `정류소 ${arsId}의 도착 정보가 없습니다.`);

  const now = Date.now();
  // 데이터가 만들어진 시각 기준 → 받은 뒤 지난 시간만큼 빼서 "지금 기준"으로 맞춤
  const routes = items.map((r) => {
    const made = kstTime(r.mkTm);
    const lag = made && now - made > 0 && now - made < 5 * 60_000 ? Math.round((now - made) / 1000) : 0;
    const buses = [busOf(r, 1), busOf(r, 2)].map((b) => (b.etaSec == null ? b : { ...b, etaSec: Math.max(0, b.etaSec - lag) }));
    const style = routeStyle(r.routeType, r.rtNm);
    return {
      id: String(r.busRouteId || r.rtNm),
      name: r.rtNm,
      ...style,
      towards: r.adirection || '',       // 노선 방향(종점 쪽)
      next: r.nxtStn || '',              // 다음 정류장
      term: num(r.term),                 // 배차 간격(분)
      first: r.firstTm ? String(r.firstTm).slice(-6, -2) : '',
      lastTm: r.lastTm ? String(r.lastTm).slice(-6, -2) : '',
      buses,
    };
  });
  routes.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));

  return {
    arsId,
    name: items[0].stNm || '',
    direction: mainDirection(items),
    windowMin: WINDOW_MIN,
    demo: isDemo(),
    routes,
  };
}
