// 예시 데이터: 인증키가 없을 때 화면을 만들고 시험해 볼 수 있게 공공 API와 같은 모양으로 만들어 줌
// 실제 버스 정보가 아님 (화면에 "예시 데이터"로 표시됨)

// 길 건너 양쪽 정류소를 쌍으로 둠 (같은 이름, 다른 번호, 다른 다음 정류장)
const STOPS = [
  ['22009', '강남역', 37.49795, 127.02763, '신논현역'],
  ['22010', '강남역', 37.49852, 127.02813, '역삼역'],
  ['22011', '강남역.강남역사거리', 37.49690, 127.02870, '뱅뱅사거리'],
  ['23285', '역삼역', 37.50067, 127.03602, '강남역'],
  ['23286', '역삼역', 37.50104, 127.03700, '선릉역'],
  ['02006', '서울시청', 37.56562, 126.97719, '광화문'],
  ['02007', '서울시청', 37.56505, 126.97798, '시청앞.덕수궁'],
  ['01001', '광화문', 37.57138, 126.97690, '세종문화회관'],
  ['01002', '광화문', 37.57104, 126.97614, '서울시청'],
  ['03278', '서울역버스환승센터', 37.55505, 126.97272, '숭례문'],
  ['14004', '홍대입구역', 37.55705, 126.92370, '서교동'],
  ['14005', '홍대입구역', 37.55667, 126.92442, '신촌로터리'],
  ['12010', '신촌오거리.현대백화점', 37.55576, 126.93630, '이대역'],
  ['21001', '잠실역', 37.51332, 127.10012, '잠실새내역'],
  ['21002', '잠실역', 37.51400, 127.10140, '석촌호수'],
];

const ROUTE_POOL = [
  ['140', 3, '도봉산역광역환승센터'], ['402', 3, '광화문'], ['470', 3, '상암차고지'], ['740', 3, '덕은동'],
  ['3412', 4, '강동공영차고지'], ['4412', 4, '교대역'], ['6411', 4, '구로동'], ['4312', 4, '송파공영차고지'],
  ['9404', 6, '분당구미동'], ['9711', 6, '마두역'], ['M5121', 6, '수원역'], ['1100', 8, '신갈'],
  ['서초03', 2, '양재역'], ['강남01', 2, '신사역'], ['N13', 3, '상계주공7단지'], ['N37', 3, '송파공영차고지'],
  ['6001', 1, '인천공항'], ['02', 5, '남산순환'],
];

// 같은 입력이면 같은 결과가 나오는 난수
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const toStop = ([arsId, name, lat, lng]) => ({ arsId, name, lat, lng });

export function searchStops(q) {
  const hits = STOPS.filter((s) => s[1].includes(q)).map(toStop);
  if (hits.length) return hits;
  // 아무 이름이나 검색해도 결과가 나오게 (예시)
  return [
    { arsId: '99001', name: `${q}`, lat: 37.5665, lng: 126.978 },
    { arsId: '99002', name: `${q}`, lat: 37.5667, lng: 126.9783 },
  ];
}

const R = 6371000;
function distM(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

const NAMES = ['사거리', '주민센터', '초등학교', '시장입구', '공원앞', '아파트', '우체국', '보건소', '파출소', '도서관'];

export function nearbyStops(lat, lng, radius) {
  const known = STOPS.map(toStop).map((s) => ({ ...s, dist: distM(lat, lng, s.lat, s.lng) })).filter((s) => s.dist <= radius);
  // 주변에 아는 정류소가 적으면 가짜 정류소를 쌍으로 만들어 채움 (약 100m 격자 기준이라 지도를 움직여도 그대로)
  const out = [...known];
  const g = 0.002;
  const baseLat = Math.round(lat / g) * g, baseLng = Math.round(lng / g) * g;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const cLat = baseLat + i * g, cLng = baseLng + j * g;
    const r = rng(`${cLat.toFixed(4)},${cLng.toFixed(4)}`);
    if (r() < 0.45) continue;
    const name = `예시${NAMES[Math.floor(r() * NAMES.length)]}`;
    const pLat = cLat + (r() - 0.5) * g * 0.6, pLng = cLng + (r() - 0.5) * g * 0.6;
    const code = 90000 + Math.floor(r() * 4000) * 2;
    for (const [k, d] of [[0, 0.00012], [1, -0.00012]]) {
      const s = { arsId: String(code + k), name, lat: pLat + d, lng: pLng - d };
      s.dist = distM(lat, lng, s.lat, s.lng);
      if (s.dist <= radius) out.push(s);
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.0`;
}

function msg(sec, stops) {
  if (sec < 60) return '곧 도착';
  return `${Math.floor(sec / 60)}분${sec % 60}초후[${stops}번째 전]`;
}

export function arrivalItems(arsId) {
  const known = STOPS.find((s) => s[0] === arsId);
  const r0 = rng(arsId);
  const name = known ? known[1] : `예시정류소 ${arsId}`;
  const next = known ? known[4] : `예시다음정류장${Math.floor(r0() * 9) + 1}`;
  const count = 5 + Math.floor(r0() * 6);
  const pool = [...ROUTE_POOL].sort(() => r0() - 0.5).slice(0, count);
  // 1분마다 바뀌는 값 → 자동 갱신 때 시간이 조금씩 줄어드는 것처럼 보이게
  const minute = Math.floor(Date.now() / 60_000);
  return pool.map(([rtNm, routeType, adirection], idx) => {
    const r = rng(`${arsId}:${rtNm}`);
    const term = [6, 8, 10, 12, 15, 20, 25][Math.floor(r() * 7)];
    const offset = Math.floor(r() * term * 60);
    const t1 = (term * 60 - ((minute * 60 + offset) % (term * 60)));
    const t2 = t1 + term * 60 + Math.floor((r() - 0.5) * 120);
    const ended = idx === count - 1 && r() < 0.6;
    const night = /^N/.test(rtNm);
    const row = {
      stNm: name, arsId, busRouteId: `1000${idx}${rtNm.length}`, rtNm, routeType: String(routeType),
      adirection, nxtStn: idx % 4 === 3 ? `${next}.입구` : next, term: String(term), mkTm: kstNow(),
      firstTm: '20261125040000', lastTm: '20261125223000',
    };
    if (ended || night) {
      Object.assign(row, { arrmsg1: night ? '출발대기' : '운행종료', arrmsg2: night ? '출발대기' : '운행종료', traTime1: '0', traTime2: '0' });
    } else {
      Object.assign(row, {
        arrmsg1: msg(t1, Math.max(1, Math.round(t1 / 100))), traTime1: String(t1),
        arrmsg2: msg(t2, Math.max(1, Math.round(t2 / 100))), traTime2: String(t2),
        stationNm1: `예시정류장${Math.floor(r() * 20) + 1}`, stationNm2: `예시정류장${Math.floor(r() * 20) + 21}`,
        plainNo1: `서울74사${1000 + Math.floor(r() * 8999)}`, plainNo2: `서울74사${1000 + Math.floor(r() * 8999)}`,
        busType1: r() < 0.7 ? '1' : '0', busType2: r() < 0.7 ? '1' : '0',
        rerdie_Div1: '4', reride_Num1: String(3 + Math.floor(r() * 3)),
        rerdie_Div2: '4', reride_Num2: String(3 + Math.floor(r() * 3)),
        isLast1: '0', isLast2: '0', isFullFlag1: '0', isFullFlag2: '0',
      });
    }
    return row;
  });
}
