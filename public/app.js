const $ = (id) => document.getElementById(id);
const REFRESH_MS = 30_000;
const WINDOW_SEC = 60 * 60;
const MAX_FAVS = 6;
const FAV_KEY = 'bus.favs';   // [{ arsId, name, dir, route, color }]  route: 노선 이름, null이면 전체 노선
const SEOUL_HALL = { lat: 37.5665, lng: 126.978 };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let stop = null;         // { arsId, name }
let routeSel = null;     // 선택한 노선 이름 (null = 전체)
let data = null;         // 마지막 도착정보 응답
let fetchedAt = 0;
let timer = null;
let loadSeq = 0;
let view = 'home';       // 'home' | 'result'
let config = { naverMapClientId: '', demo: false };
const configReady = fetch('/api/config', { cache: 'no-store' }).then((r) => r.json()).then((c) => { config = c; }).catch(() => {});

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `오류 ${res.status}`);
  return body;
}
const searchApi = async (q) => { const l = await getJson(`/api/search?q=${encodeURIComponent(q)}`); return Array.isArray(l) ? l : []; };
const arrivalsApi = (arsId) => getJson(`/api/arrivals?stop=${encodeURIComponent(arsId)}`);

// 두 지점 거리(m)
function distM(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const fmtDist = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);

// ======================================================================
// 자주 가는 정류소 (정류소 + 노선, 최대 6개)
// ======================================================================
const favs = () => store.get(FAV_KEY, []);
function saveFavs(list) {
  store.set(FAV_KEY, list);
  renderFavViews();
}
const favKey = (f) => `${f.arsId}|${f.route || ''}`;
const isCurrentFav = (f) => stop && f.arsId === stop.arsId && (f.route || null) === routeSel;

function addFav(item) {
  const list = favs();
  if (list.some((f) => favKey(f) === favKey(item))) { toast('이미 저장된 정류소예요.'); return false; }
  if (list.length >= MAX_FAVS) { toast(`최대 ${MAX_FAVS}개까지 저장할 수 있어요. 설정에서 정리해 주세요.`); return false; }
  list.push(item);
  saveFavs(list);
  toast(`${item.name}${item.route ? ' ' + item.route : ''} 저장됨`);
  return true;
}

function favLabel(f) {
  return (f.color ? `<i class="dot" style="background:${esc(f.color)}"></i>` : '') +
    `${esc(f.name)} <span>${f.route ? esc(f.route) : esc(f.arsId)}</span>`;
}

// 처음 화면 카드 + 상단 칩 + 설정 목록 + ☆ 버튼을 한 번에 갱신
function renderFavViews() {
  const list = favs();

  const quick = $('quick');
  quick.innerHTML = '';
  for (const f of list) {
    const b = document.createElement('button');
    b.className = 'quick-card';
    b.style.setProperty('--c', f.color || 'var(--accent)');
    b.innerHTML = `<span class="q-line">${esc(f.route || '전체 노선')}</span><span class="q-name">${esc(f.name)}</span>` +
      `<span class="q-dir">${f.dir ? '→ ' + esc(f.dir) + ' 방면' : esc(f.arsId)}</span>`;
    b.onclick = () => openStop(f.arsId, { name: f.name, route: f.route || null, push: true });
    quick.append(b);
  }
  $('quickEmpty').hidden = list.length > 0;

  const box = $('favs');
  box.innerHTML = '';
  for (const f of list) {
    const b = document.createElement('button');
    b.innerHTML = favLabel(f);
    if (isCurrentFav(f)) b.className = 'on';
    b.onclick = () => openStop(f.arsId, { name: f.name, route: f.route || null });
    box.append(b);
  }
  box.hidden = view !== 'result' || list.length === 0;

  const on = list.some(isCurrentFav);
  $('favBtn').textContent = on ? '★' : '☆';
  $('favBtn').classList.toggle('on', on);
  $('favBtn').disabled = !stop;

  renderFavSettings(list);
}

$('favBtn').onclick = () => {
  if (!stop) return;
  const list = favs();
  const i = list.findIndex(isCurrentFav);
  if (i >= 0) { list.splice(i, 1); saveFavs(list); toast('저장 해제됨'); return; }
  const r = data?.routes.find((x) => x.name === routeSel);
  addFav({ arsId: stop.arsId, name: stop.name, dir: data?.direction || '', route: routeSel, color: r?.color || null });
};

// ======================================================================
// 정류소 검색 (상단 검색창 / 설정의 추가 검색창 공용)
// onMap(s): 결과 옆 📍 → 지도에서 위치 확인
// ======================================================================
function makeSearch(input, ul, onPick, onMap) {
  let seq = 0, active = -1, items = [], debounce;
  const hide = () => { ul.hidden = true; active = -1; };
  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (!q) { items = []; return hide(); }
    try {
      const list = await searchApi(q);
      if (my !== seq) return;
      items = list;
      ul.innerHTML = '';
      const sameName = new Map();
      for (const s of items) sameName.set(s.name, (sameName.get(s.name) || 0) + 1);
      for (const s of items) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="name">${esc(s.name)}</span><span class="ars">${esc(s.arsId)}</span>` +
          (sameName.get(s.name) > 1 ? '<span class="twin">길 건너편 있음</span>' : '') +
          (s.lat ? '<button class="li-map" aria-label="지도에서 보기">📍</button>' : '');
        li.onclick = () => pick(s);
        const mb = li.querySelector('.li-map');
        if (mb) mb.onclick = (e) => { e.stopPropagation(); hide(); input.blur(); onMap(s); };
        ul.append(li);
      }
      active = -1;
      ul.hidden = items.length === 0;
      if (!items.length && q.length >= 2) {
        ul.innerHTML = '<li class="muted">검색 결과가 없어요. 이름을 바꿔 보거나 📍 지도에서 찾아보세요.</li>';
        ul.hidden = false;
      }
    } catch (e) {
      if (my !== seq) return;
      ul.innerHTML = `<li class="muted">${esc(e.message || '검색하지 못했어요.')}</li>`;
      ul.hidden = false;
    }
  };
  const pick = (s) => {
    hide();
    input.value = '';
    input.blur();
    items = [];
    onPick(s);
  };
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 250); });
  input.addEventListener('keydown', async (e) => {
    const lis = [...ul.querySelectorAll('li:not(.muted)')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!lis.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
      lis.forEach((li, i) => li.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce);
      if (!items.length) await run();
      const s = items[active] || items[0];
      if (s) pick(s);
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  document.addEventListener('click', (e) => { if (!ul.parentElement.contains(e.target)) hide(); });
}

// ======================================================================
// 화면 전환 (처음 화면 ↔ 도착정보). 휴대폰 뒤로가기 지원.
// ======================================================================
function showHome({ push = false } = {}) {
  view = 'home';
  clearTimeout(timer);
  loadSeq++;
  stop = null; routeSel = null; data = null;
  $('home').hidden = false;
  $('result').hidden = true;
  $('error').hidden = true;
  if (push) history.pushState({ view: 'home' }, '', location.pathname);
  renderFavViews();
  window.scrollTo(0, 0);
}
$('homeBtn').onclick = () => {
  if (view === 'home') return;
  if (history.state?.view === 'result' && history.state.fromHome) history.back();
  else showHome({ push: true });
};

function showResultView() {
  view = 'result';
  $('home').hidden = true;
  $('result').hidden = false;
  $('error').hidden = true;
}

window.addEventListener('popstate', (e) => {
  const st = e.state || {};
  if (!$('mapSheet').hidden && !st.map) closeMap({ fromPop: true });
  if (!$('help').hidden && !st.help) closeHelp({ fromPop: true });
  if (!$('settings').hidden && !st.settings) closeSettings({ fromPop: true });
  if (st.settings || st.help || st.map) return;
  if (st.view === 'result' && st.stop) {
    if (!stop || stop.arsId !== st.stop) openStop(st.stop, { route: st.route || null, history: false });
    else if ((st.route || null) !== routeSel) selectRoute(st.route || null, { history: false });
  } else if (view !== 'home') {
    showHome();
  }
});

// ======================================================================
// 정류소 선택 → (노선 선택) → 도착정보
// ======================================================================
makeSearch($('q'), $('suggest'),
  (s) => openStop(s.arsId, { name: s.name, push: view === 'home' }),
  (s) => openMap({ mode: 'view', focus: s }));

const urlFor = () => `?stop=${encodeURIComponent(stop.arsId)}${routeSel ? `&route=${encodeURIComponent(routeSel)}` : ''}`;

function openStop(arsId, { name = '', route = null, push = false, history: useHistory = true } = {}) {
  stop = { arsId, name };
  routeSel = route;
  data = null;
  clearTimeout(timer);
  showResultView();
  renderHead();
  $('routeTabs').innerHTML = '';
  $('meta').textContent = '';
  $('warn').hidden = true;
  if (useHistory) {
    const st = { view: 'result', stop: arsId, route, fromHome: push };
    if (push) history.pushState(st, '', urlFor());
    else history.replaceState({ ...(history.state || {}), ...st, fromHome: history.state?.fromHome || false }, '', urlFor());
  }
  renderFavViews();
  window.scrollTo(0, 0);
  load();
}

function renderHead() {
  $('stopName').textContent = stop.name || '정류소';
  $('stopSub').innerHTML = `<span class="ars">${esc(stop.arsId)}</span>` +
    (data?.direction ? ` <b>→ ${esc(data.direction)}</b> 방면` : '');
}

function renderRouteTabs() {
  const box = $('routeTabs');
  box.innerHTML = '';
  const mk = (label, name, color) => {
    const b = document.createElement('button');
    const on = name === routeSel;
    b.className = 'line-tab' + (on ? ' on' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', on);
    if (color) b.style.setProperty('--c', color);
    b.textContent = label;
    b.onclick = () => selectRoute(name);
    box.append(b);
    if (on) requestAnimationFrame(() => b.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  };
  mk('전체', null, null);
  for (const r of data.routes) mk(r.name, r.name, r.color);
}

function selectRoute(name, { history: useHistory = true } = {}) {
  routeSel = name;
  if (useHistory) history.replaceState({ ...(history.state || {}), route: name }, '', urlFor());
  renderRouteTabs();
  renderFavViews();
  render();
}

async function load({ silent = false } = {}) {
  if (!stop) return;
  const seq = ++loadSeq;
  if (!data) $('groups').innerHTML = '<p class="none">불러오는 중…</p>';
  $('refreshBtn').classList.add('spin');
  try {
    const body = await arrivalsApi(stop.arsId);
    if (seq !== loadSeq) return; // 그 사이 다른 정류소를 골랐음
    data = body;
    fetchedAt = Date.now();
    stop.name = body.name || stop.name;
    if (routeSel && !data.routes.some((r) => r.name === routeSel)) routeSel = null;
    $('error').hidden = true;
    renderHead();
    renderRouteTabs();
    renderFavViews();
    render();
  } catch (e) {
    if (seq !== loadSeq) return;
    if (!silent || !data) {
      $('groups').innerHTML = '';
      showError(e.message || '불러오지 못했습니다.');
    }
  } finally {
    if (seq === loadSeq) $('refreshBtn').classList.remove('spin');
  }
  if (seq === loadSeq) schedule();
}
$('refreshBtn').onclick = () => load();

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = false;
}

function schedule() {
  clearTimeout(timer);
  if (document.visibilityState === 'visible' && view === 'result' && stop) {
    timer = setTimeout(() => load({ silent: true }), REFRESH_MS);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view === 'result' && stop) load({ silent: true });
  else clearTimeout(timer);
});

// ---------- 도착정보 렌더링 ----------
function etaHtml(sec) {
  if (sec < 60) return { html: '곧 도착', cls: 'now' };
  return { html: `${Math.floor(sec / 60)}<small>분</small>`, cls: '' };
}

// 지금 기준 남은 시간으로 다시 계산
function busesNow(route) {
  const elapsed = (Date.now() - fetchedAt) / 1000;
  return route.buses.map((b) => {
    if (b.etaSec == null) return { ...b, eta: null };
    const eta = b.etaSec - elapsed;
    return { ...b, eta: eta < -60 ? null : Math.max(0, eta), gone: eta < -60 };
  });
}

function busSub(b) {
  return [
    b.stops ? `${b.stops}번째 전` : '',
    b.crowd,
    b.full ? '만차' : '',
  ].filter(Boolean).join(' · ');
}

function render() {
  if (!data) return;
  const d = new Date(fetchedAt);
  $('meta').textContent = `${d.toLocaleTimeString('ko-KR', { hour12: false })} 기준 · ${data.windowMin % 60 ? data.windowMin + "분" : data.windowMin / 60 + "시간"} 이내 · 30초마다 자동 갱신`;
  $('warn').hidden = !data.demo;
  $('warn').textContent = data.demo ? '⚠ 예시 데이터입니다. 실제 버스 정보가 아니에요. (버스 인증키 설정 전)' : '';

  const list = data.routes.filter((r) => !routeSel || r.name === routeSel);
  const active = [], idle = [];
  for (const r of list) {
    const buses = busesNow(r);
    const within = buses.filter((b) => b.eta != null && b.eta <= WINDOW_SEC);
    if (within.length) active.push({ r, buses, within });
    else {
      const next = buses.find((b) => b.eta != null);
      const why = next ? `다음 버스 약 ${Math.round(next.eta / 60)}분 후`
        : buses.find((b) => b.status)?.status || '도착 정보 없음';
      idle.push({ r, why });
    }
  }
  active.sort((a, b) => a.within[0].eta - b.within[0].eta);

  let html = '';
  if (!active.length) html += `<p class="none center">앞으로 1시간 안에 오는 ${routeSel ? esc(routeSel) + '번 ' : ''}버스가 없습니다.</p>`;
  for (const { r, buses, within } of active) {
    html += `<article class="route-card" style="--c:${esc(r.color)}">
      <div class="rc-head"><span class="rno">${esc(r.name)}</span><span class="rtype">${esc(r.type)}</span>` +
      `<span class="rdir">${r.towards ? esc(r.towards) + ' 방면' : ''}</span></div>
      <div class="rc-buses">`;
    for (let i = 0; i < 2; i++) {
      const b = within[i];
      if (b) {
        const e = etaHtml(b.eta);
        html += `<div class="bus"><div class="eta ${e.cls}"><span class="t">${e.html}</span></div>
          <div class="info"><div class="sub">${esc(busSub(b)) || '&nbsp;'}</div>
          <div class="tags">${b.lowFloor ? '<span class="tag low">저상</span>' : ''}${b.last ? '<span class="tag last">막차</span>' : ''}</div></div></div>`;
      } else {
        const other = buses[i];
        const txt = other?.eta != null ? `다음 약 ${Math.round(other.eta / 60)}분` : other?.status || (r.term ? `배차 ${r.term}분` : '–');
        html += `<div class="bus empty-bus"><span>${esc(txt)}</span></div>`;
      }
    }
    html += `</div></article>`;
  }
  if (idle.length) {
    const rows = idle.map(({ r, why }) => `<li><span class="rno sm" style="--c:${esc(r.color)}">${esc(r.name)}</span><span class="why">${esc(why)}</span></li>`).join('');
    html += routeSel
      ? `<ul class="idle-list">${rows}</ul>`
      : `<details class="idle"><summary>1시간 안에 안 오는 노선 ${idle.length}개</summary><ul class="idle-list">${rows}</ul></details>`;
  }
  const open = $('groups').querySelector('details.idle')?.open;
  $('groups').innerHTML = html;
  if (open) $('groups').querySelector('details.idle')?.setAttribute('open', '');
}
// 남은 시간 표시는 10초마다 다시 계산
setInterval(() => { if (data && view === 'result' && document.visibilityState === 'visible') render(); }, 10_000);

// ======================================================================
// 지도에서 주변 정류소 찾기 (네이버 지도)
// - 네이버 지도 키가 없거나 인증 실패면 지도 없이 "가까운 정류소 목록"만 보여줌
// ======================================================================
const mp = {
  mode: 'view', onPick: null,
  map: null, naver: null,         // 네이버 지도 사용 가능 여부 (null = 아직 모름)
  me: null, meAt: 0,              // 내 위치 { lat, lng }
  searched: null,                 // 마지막으로 주변 정류소를 찾은 중심
  stops: [], markers: new Map(), meMarker: null,
  selected: null, seq: 0, focus: null,
  preview: new Map(),             // 정류소별 도착정보 미리보기 캐시
};

async function loadNaver() {
  await configReady;
  if (mp.naver !== null) return mp.naver;
  if (!config.naverMapClientId) return (mp.naver = false);
  return new Promise((resolve) => {
    const done = (ok) => { if (mp.naver === null) { mp.naver = ok; resolve(ok); } };
    // 네이버가 인증 실패 시 부르는 함수 (등록하지 않은 주소에서 열었거나 키가 틀림)
    window.navermap_authFailure = () => {
      mp.naver = false;
      if (mp.map) { try { mp.map.destroy(); } catch {} mp.map = null; }
      showMapMsg('네이버 지도 인증에 실패했어요 (네이버 클라우드에 이 사이트 주소 등록 필요). 목록으로 보여드려요.');
      $('map').hidden = true;
      $('mapSheet').classList.add('no-map');
      done(false);
    };
    const s = document.createElement('script');
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(config.naverMapClientId)}`;
    s.onload = () => done(!!window.naver?.maps);
    s.onerror = () => done(false);
    setTimeout(() => done(!!window.naver?.maps), 10_000);
    document.head.append(s);
  });
}

function showMapMsg(msg) {
  $('mapMsg').textContent = msg || '';
  $('mapMsg').hidden = !msg;
}

function getLocation({ fresh = false } = {}) {
  if (!fresh && mp.me && Date.now() - mp.meAt < 60_000) return Promise.resolve(mp.me);
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => { mp.me = { lat: p.coords.latitude, lng: p.coords.longitude }; mp.meAt = Date.now(); resolve(mp.me); },
      (err) => { mp.locError = err.code === 1 ? 'denied' : 'fail'; resolve(null); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

async function openMap({ mode = 'view', focus = null, onPick = null } = {}) {
  mp.mode = mode; mp.onPick = onPick; mp.focus = focus?.lat ? focus : null;
  mp.selected = null; mp.stops = []; mp.searched = null;
  $('mapSheet').hidden = false;
  $('mapSheet').classList.remove('no-map');
  $('map').hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ ...(history.state || {}), map: true }, '', location.href);
  $('mapTitle').textContent = mode === 'pick' ? '정류소 고르기' : '주변 정류소';
  $('mapPick').hidden = true;
  $('mapResearch').hidden = true;
  $('mapList').innerHTML = '<li class="muted">위치를 확인하는 중…</li>';
  $('mapListTitle').textContent = '';
  showMapMsg('');

  const [ok, me] = await Promise.all([loadNaver(), mp.focus ? getLocation().catch(() => null) : getLocation({ fresh: true })]);
  if ($('mapSheet').hidden) return;
  let center = mp.focus || me;
  if (!center) {
    center = SEOUL_HALL;
    showMapMsg(mp.locError === 'denied'
      ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 위치를 허용하면 내 주변이 보여요. 지금은 서울시청 주변이에요.'
      : '내 위치를 찾지 못해 서울시청 주변을 보여드려요.');
  }
  if (ok) makeMap(center);
  else {
    $('map').hidden = true;
    $('mapSheet').classList.add('no-map');
    if (!config.naverMapClientId && !$('mapMsg').textContent) showMapMsg('지도 키가 아직 설정되지 않아 가까운 정류소를 목록으로 보여드려요.');
  }
  await searchAt(center);
}

function closeMap({ fromPop = false } = {}) {
  if ($('mapSheet').hidden) return;
  $('mapSheet').hidden = true;
  if ($('settings').hidden && $('help').hidden) document.body.classList.remove('no-scroll');
  mp.seq++;
  if (mp.map) { try { mp.map.destroy(); } catch {} mp.map = null; }
  mp.markers.clear(); mp.meMarker = null;
  if (!fromPop && history.state?.map) history.back();
}
$('mapClose').onclick = () => closeMap();
$('mapBtn').onclick = () => openMap({ mode: 'view' });
$('nearBtn').onclick = () => openMap({ mode: 'view' });

function makeMap(center) {
  const N = window.naver.maps;
  if (mp.map) { try { mp.map.destroy(); } catch {} }
  mp.markers.clear();
  mp.map = new N.Map($('map'), {
    center: new N.LatLng(center.lat, center.lng),
    zoom: 17,
    minZoom: 12,
    scaleControl: false,
    mapDataControl: false,
    logoControlOptions: { position: N.Position.BOTTOM_LEFT },
  });
  mp.meMarker = null;
  drawMe();
  N.Event.addListener(mp.map, 'idle', () => {
    if (!mp.searched) return;
    const c = mp.map.getCenter();
    $('mapResearch').hidden = distM(mp.searched, { lat: c.lat(), lng: c.lng() }) < 250;
  });
  N.Event.addListener(mp.map, 'click', () => selectStop(null));
}

function drawMe() {
  if (!mp.map || !mp.me) return;
  const N = window.naver.maps;
  const pos = new N.LatLng(mp.me.lat, mp.me.lng);
  if (mp.meMarker) return mp.meMarker.setPosition(pos);
  mp.meMarker = new N.Marker({
    position: pos, map: mp.map, zIndex: 50, clickable: false,
    icon: { content: '<div class="me-dot"></div>', anchor: new N.Point(11, 11) },
  });
}

$('myLocBtn').onclick = async () => {
  $('myLocBtn').classList.add('spin');
  const me = await getLocation({ fresh: true });
  $('myLocBtn').classList.remove('spin');
  if (!me) { toast(mp.locError === 'denied' ? '위치 권한을 허용해 주세요.' : '내 위치를 찾지 못했어요.'); return; }
  showMapMsg('');
  if (mp.map) { drawMe(); mp.map.panTo(new window.naver.maps.LatLng(me.lat, me.lng)); }
  if (!mp.searched || distM(mp.searched, me) > 250) searchAt(me);
};

$('mapResearch').onclick = () => {
  if (!mp.map) return;
  const c = mp.map.getCenter();
  searchAt({ lat: c.lat(), lng: c.lng() });
};

async function searchAt(center) {
  const my = ++mp.seq;
  $('mapResearch').hidden = true;
  $('mapListTitle').textContent = '주변 정류소를 찾는 중…';
  // 약 100m 단위로 반올림해서 같은 동네는 서버 캐시를 같이 씀
  const lat = center.lat.toFixed(3), lng = center.lng.toFixed(3);
  try {
    const list = await getJson(`/api/nearby?lat=${lat}&lng=${lng}&radius=500`);
    if (my !== mp.seq) return;
    mp.searched = center;
    if (mp.focus && !list.some((s) => s.arsId === mp.focus.arsId)) list.push({ ...mp.focus });
    mp.stops = list;
    drawStops();
    renderMapList();
    if (mp.focus) {
      const f = list.find((s) => s.arsId === mp.focus.arsId);
      mp.focus = null;
      if (f) selectStop(f, { pan: true });
    }
  } catch (e) {
    if (my !== mp.seq) return;
    $('mapListTitle').textContent = '';
    $('mapList').innerHTML = `<li class="muted">${esc(e.message || '주변 정류소를 찾지 못했어요.')}</li>`;
  }
}

function pinHtml(s, on) {
  return `<div class="pin${on ? ' on' : ''}"><span class="pin-ico">🚏</span>${on ? `<span class="pin-label">${esc(s.name)}</span>` : ''}</div>`;
}

function drawStops() {
  if (!mp.map) return;
  const N = window.naver.maps;
  for (const m of mp.markers.values()) m.setMap(null);
  mp.markers.clear();
  for (const s of mp.stops) {
    if (s.lat == null) continue;
    const m = new N.Marker({
      position: new N.LatLng(s.lat, s.lng), map: mp.map, zIndex: 10,
      icon: { content: pinHtml(s, false), anchor: new N.Point(15, 30) },
    });
    N.Event.addListener(m, 'click', () => selectStop(s));
    mp.markers.set(s.arsId, m);
  }
}

const distFromMe = (s) => (s.lat != null && (mp.me || mp.searched) ? distM(mp.me || mp.searched, s) : s.dist);

function renderMapList() {
  const ul = $('mapList');
  ul.innerHTML = '';
  const list = [...mp.stops].sort((a, b) => (distFromMe(a) ?? 1e9) - (distFromMe(b) ?? 1e9));
  $('mapListTitle').textContent = list.length
    ? `${mp.me ? '내 위치에서 ' : ''}가까운 정류소 ${list.length}곳`
    : '';
  if (!list.length) ul.innerHTML = '<li class="muted">500m 안에 정류소가 없어요. 지도를 옮겨서 다시 찾아보세요.</li>';
  const sameName = new Map();
  for (const s of list) sameName.set(s.name, (sameName.get(s.name) || 0) + 1);
  for (const s of list) {
    const li = document.createElement('li');
    li.dataset.ars = s.arsId;
    li.className = mp.selected?.arsId === s.arsId ? 'on' : '';
    const pv = mp.preview.get(s.arsId);
    li.innerHTML = `<span class="ml-main"><b>${esc(s.name)}</b>` +
      `<small>${esc(s.arsId)}${pv?.direction ? ` · → ${esc(pv.direction)} 방면` : sameName.get(s.name) > 1 ? ' · 길 건너편 있음' : ''}</small></span>` +
      `<span class="ml-dist">${fmtDist(distFromMe(s))}</span>`;
    li.onclick = () => selectStop(s, { pan: true });
    ul.append(li);
  }
}

async function selectStop(s, { pan = false } = {}) {
  const prev = mp.selected;
  mp.selected = s;
  if (mp.map) {
    if (prev && mp.markers.has(prev.arsId)) {
      const m = mp.markers.get(prev.arsId);
      m.setIcon({ content: pinHtml(prev, false), anchor: new window.naver.maps.Point(15, 30) });
      m.setZIndex(10);
    }
    if (s && mp.markers.has(s.arsId)) {
      const m = mp.markers.get(s.arsId);
      m.setIcon({ content: pinHtml(s, true), anchor: new window.naver.maps.Point(15, 30) });
      m.setZIndex(100);
      if (pan) mp.map.panTo(new window.naver.maps.LatLng(s.lat, s.lng));
    }
  }
  $('mapList').querySelectorAll('li').forEach((li) => li.classList.toggle('on', !!s && li.dataset.ars === s.arsId));
  renderPickCard();
  if (!s) return;
  // 선택 카드(이 정류소 보기 버튼)가 보이게 아래 패널을 맨 위로
  document.querySelector('.map-panel').scrollTo({ top: 0, behavior: 'smooth' });
  if (!mp.preview.has(s.arsId)) {
    try {
      const d = await arrivalsApi(s.arsId);
      mp.preview.set(s.arsId, { direction: d.direction, routes: d.routes.map((r) => ({ name: r.name, color: r.color })), name: d.name });
    } catch (e) {
      mp.preview.set(s.arsId, { error: e.message });
    }
    if (mp.selected === s) { renderPickCard(); renderMapList(); }
  }
}

function renderPickCard() {
  const s = mp.selected, box = $('mapPick');
  box.hidden = !s;
  if (!s) return;
  const pv = mp.preview.get(s.arsId);
  const routes = pv?.routes
    ? pv.routes.slice(0, 14).map((r) => `<span class="badge" style="background:${esc(r.color)}">${esc(r.name)}</span>`).join('') +
      (pv.routes.length > 14 ? `<span class="more">+${pv.routes.length - 14}</span>` : '')
    : '';
  box.innerHTML = `
    <div class="mp-head"><b>${esc(s.name)}</b><span class="ars">${esc(s.arsId)}</span><span class="ml-dist">${fmtDist(distFromMe(s))}</span></div>
    <p class="mp-dir">${pv ? (pv.error ? esc(pv.error) : pv.direction ? `→ <b>${esc(pv.direction)}</b> 방면` : '') : '방향 확인 중…'}</p>
    <div class="mp-routes">${routes}</div>
    <button id="mapGo" class="primary">${mp.mode === 'pick' ? '이 정류소 선택' : '이 정류소 버스 보기'}</button>`;
  $('mapGo').onclick = () => {
    const pick = { arsId: s.arsId, name: pv?.name || s.name, dir: pv?.direction || '' };
    if (mp.mode === 'pick') {
      const cb = mp.onPick;
      closeMap();
      cb?.(pick);
    } else {
      closeMap();
      // 지도 기록을 지운 뒤(뒤로가기 처리) 도착 화면으로 이동
      setTimeout(() => openStop(pick.arsId, { name: pick.name, push: view === 'home' }), 60);
    }
  };
}

// ======================================================================
// 설정
// ======================================================================
function openSettings() {
  $('settings').hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ ...(history.state || {}), settings: true }, '', location.href);
  $('iconNote').hidden = true;
  $('cropBox').hidden = true;
  renderIconEditor();
  renderInstall();
  renderFavViews();
}
function closeSettings({ fromPop = false } = {}) {
  if ($('settings').hidden) return;
  $('settings').hidden = true;
  document.body.classList.remove('no-scroll');
  resetAdd();
  if (!fromPop && history.state?.settings) history.back();
}
$('settingsBtn').onclick = openSettings;
$('quickSetup').onclick = openSettings;
$('settingsClose').onclick = () => closeSettings();

// ---------- 사용 방법 (?) ----------
function openHelp() {
  $('help').hidden = false;
  document.body.classList.add('no-scroll');
  $('help').querySelector('.sheet-body').scrollTop = 0;
  history.pushState({ ...(history.state || {}), help: true }, '', location.href);
}
function closeHelp({ fromPop = false } = {}) {
  if ($('help').hidden) return;
  $('help').hidden = true;
  document.body.classList.remove('no-scroll');
  if (!fromPop && history.state?.help) history.back();
}
$('helpBtn').onclick = openHelp;
$('helpClose').onclick = () => closeHelp();
$('helpToSettings').onclick = () => {
  // 도움말 기록을 설정으로 바꿔서, 설정에서 뒤로가기하면 처음 화면으로
  $('help').hidden = true;
  history.replaceState({ ...(history.state || {}), help: false }, '', location.href);
  history.back();
  setTimeout(openSettings, 50);
};

// ---------- 홈 화면 아이콘 저장 ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();      // 브라우저 기본 배너 대신 설정의 버튼으로 설치
  installPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('홈 화면에 아이콘이 추가됐어요.');
  renderInstall();
});

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSamsung = () => /SamsungBrowser/i.test(navigator.userAgent);

function renderInstall() {
  const msg = $('installMsg'), btn = $('installBtn'), steps = $('installSteps');
  btn.hidden = true; steps.hidden = true; steps.innerHTML = '';
  const setSteps = (arr) => { steps.innerHTML = arr.map((s) => `<li>${s}</li>`).join(''); steps.hidden = false; };

  if (isStandalone()) {
    msg.textContent = '✅ 이미 홈 화면 아이콘으로 실행 중이에요.';
  } else if (installPrompt) {
    msg.textContent = '버튼을 누르면 휴대폰 홈 화면에 앱 아이콘이 생겨요.';
    btn.hidden = false;
  } else if (isIOS()) {
    msg.textContent = '아이폰은 Safari에서 직접 추가해야 해요.';
    setSteps([
      'Safari로 이 페이지를 엽니다 (다른 브라우저면 주소를 복사해 Safari에 붙여넣기).',
      '아래(또는 위)쪽 <b>공유 버튼 ⬆︎</b>을 누릅니다.',
      '<b>홈 화면에 추가</b> → <b>추가</b>를 누릅니다.',
      '홈 화면 아이콘으로 열면 여기서 저장한 정류소를 <b>다시 한 번</b> 저장해 주세요 (아이폰은 저장공간이 따로예요).',
    ]);
  } else if (isSamsung()) {
    msg.textContent = '삼성 인터넷 메뉴에서 추가할 수 있어요.';
    setSteps(['아래쪽 <b>≡ 메뉴</b>를 누릅니다.', '<b>현재 페이지 추가 → 홈 화면</b>을 누릅니다.']);
  } else {
    msg.textContent = '브라우저 메뉴에서 추가할 수 있어요.';
    setSteps(['Chrome 오른쪽 위 <b>⋮ 메뉴</b>를 누릅니다.', '<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누릅니다.']);
  }
}
$('installBtn').onclick = async () => {
  if (!installPrompt) return renderInstall();
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
  installPrompt = null;
  if (outcome !== 'accepted') toast('설치를 취소했어요. 나중에 다시 누를 수 있어요.');
  renderInstall();
};

// ---------- 아이콘 이미지 변경 (휴대폰 사진으로) ----------
const ICON_KEY = 'bus.icon';  // { base: "<업로드한 아이콘 폴더 주소>" } — 없으면 기본 아이콘
const savedIcon = () => { const ic = store.get(ICON_KEY, null); return ic && typeof ic.base === 'string' ? ic : null; };

// 브라우저가 홈 화면 추가 때 읽는 manifest / 아이폰 아이콘 / 탭 아이콘을 교체
function applyIcon(ic) {
  $('manifestLink').href = ic ? `/api/manifest?img=${encodeURIComponent(ic.base)}` : '/manifest.webmanifest';
  $('faviconLink').href = ic ? `${ic.base}/192.png` : '/icons/icon-192.png';
  $('appleIconLink').href = ic ? `${ic.base}/180.png` : '/icons/apple-touch-icon.png';
}

function renderIconEditor() {
  const ic = savedIcon();
  $('iconCurrent').src = ic ? `${ic.base}/192.png` : '/icons/icon-192.png';
  $('iconReset').disabled = !ic;
}

// 자르기 편집기: 사진을 512×512 정사각형에 맞춤
// - 끌기: 위치 / 두 손가락 벌리기·막대·−+ 버튼: 크기 / ↻: 90도 회전
// - 축소하면 사진 전체를 넣을 수 있고, 남는 부분은 고른 바탕색으로 채움
const C = 512;
const crop = { img: null, rot: 0, scale: 1, cover: 1, fit: 1, cx: C / 2, cy: C / 2, bg: '#ffffff' };
const MAX_ZOOM = 5;

const rotW = () => (crop.rot % 180 ? crop.img.naturalHeight : crop.img.naturalWidth);
const rotH = () => (crop.rot % 180 ? crop.img.naturalWidth : crop.img.naturalHeight);

function clampCrop() {
  const w = rotW() * crop.scale, h = rotH() * crop.scale;
  crop.cx = w >= C ? Math.min(w / 2, Math.max(C - w / 2, crop.cx)) : C / 2;
  crop.cy = h >= C ? Math.min(h / 2, Math.max(C - h / 2, crop.cy)) : C / 2;
}
function drawCrop() {
  const ctx = $('cropCanvas').getContext('2d');
  ctx.save();
  ctx.fillStyle = crop.bg;
  ctx.fillRect(0, 0, C, C);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(crop.cx, crop.cy);
  ctx.rotate((crop.rot * Math.PI) / 180);
  const w = crop.img.naturalWidth * crop.scale, h = crop.img.naturalHeight * crop.scale;
  ctx.drawImage(crop.img, -w / 2, -h / 2, w, h);
  ctx.restore();
}
function syncZoomUi() {
  const z = $('cropZoom');
  z.min = (crop.fit / crop.cover).toFixed(3);
  z.max = MAX_ZOOM;
  z.value = crop.scale / crop.cover;
}
function zoomTo(z, px = C / 2, py = C / 2) {
  const minZ = crop.fit / crop.cover;
  z = Math.min(MAX_ZOOM, Math.max(minZ, z));
  const k = (crop.cover * z) / crop.scale;
  crop.cx = px - (px - crop.cx) * k;
  crop.cy = py - (py - crop.cy) * k;
  crop.scale = crop.cover * z;
  clampCrop();
  drawCrop();
  syncZoomUi();
}
function resetCrop() {
  crop.cover = C / Math.min(rotW(), rotH());
  crop.fit = C / Math.max(rotW(), rotH());
  crop.scale = crop.cover;
  crop.cx = C / 2; crop.cy = C / 2;
  drawCrop();
  syncZoomUi();
}

$('photoBtn').onclick = () => $('photoInput').click();
$('photoInput').onchange = () => {
  const file = $('photoInput').files[0];
  $('photoInput').value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    crop.img = img;
    crop.rot = 0;
    resetCrop();
    $('cropBox').hidden = false;
    $('iconNote').hidden = true;
    $('cropBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('이 사진 형식은 열 수 없어요. 다른 사진을 골라 주세요.'); };
  img.src = url;
};

$('cropZoom').oninput = (e) => zoomTo(Number(e.target.value));
$('zoomOut').onclick = () => zoomTo(crop.scale / crop.cover / 1.15);
$('zoomIn').onclick = () => zoomTo((crop.scale / crop.cover) * 1.15);
$('zoomFit').onclick = () => zoomTo(crop.fit / crop.cover);
$('zoomFill').onclick = () => zoomTo(1);
$('rotateBtn').onclick = () => {
  if (!crop.img) return;
  const z = crop.scale / crop.cover;
  crop.rot = (crop.rot + 90) % 360;
  crop.cover = C / Math.min(rotW(), rotH());
  crop.fit = C / Math.max(rotW(), rotH());
  crop.scale = crop.cover * Math.max(z, crop.fit / crop.cover);
  clampCrop();
  drawCrop();
  syncZoomUi();
};
document.querySelectorAll('#cropBgs .swatch').forEach((b) => {
  b.onclick = () => {
    crop.bg = b.dataset.bg;
    document.querySelectorAll('#cropBgs .swatch').forEach((x) => x.classList.toggle('on', x === b));
    if (crop.img) drawCrop();
  };
});

// 끌기(한 손가락) + 벌리기/오므리기(두 손가락) + 마우스 휠
{
  const cv = $('cropCanvas');
  const pts = new Map();
  let start = null;
  const toCanvas = (x, y) => {
    const r = cv.getBoundingClientRect();
    return [((x - r.left) / r.width) * C, ((y - r.top) / r.height) * C];
  };
  const snapshot = () => {
    const p = [...pts.values()];
    const mid = p.length > 1 ? [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] : p[0];
    const dist = p.length > 1 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0;
    start = { mid, dist, cx: crop.cx, cy: crop.cy, z: crop.scale / crop.cover };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!crop.img) return;
    try { cv.setPointerCapture(e.pointerId); } catch { /* 일부 환경에서 실패해도 동작엔 지장 없음 */ }
    pts.set(e.pointerId, toCanvas(e.clientX, e.clientY));
    snapshot();
    $('cropFrame').classList.add('dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !crop.img) return;
    pts.set(e.pointerId, toCanvas(e.clientX, e.clientY));
    const p = [...pts.values()];
    if (p.length > 1 && start.dist > 0) {
      const mid = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
      const dist = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      crop.cx = start.cx + (mid[0] - start.mid[0]);
      crop.cy = start.cy + (mid[1] - start.mid[1]);
      crop.scale = crop.cover * start.z;
      zoomTo(start.z * (dist / start.dist), mid[0], mid[1]);
    } else {
      crop.cx = start.cx + (p[0][0] - start.mid[0]);
      crop.cy = start.cy + (p[0][1] - start.mid[1]);
      clampCrop();
      drawCrop();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size) snapshot(); else $('cropFrame').classList.remove('dragging');
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    if (!crop.img) return;
    e.preventDefault();
    const [x, y] = toCanvas(e.clientX, e.clientY);
    zoomTo((crop.scale / crop.cover) * (e.deltaY < 0 ? 1.08 : 1 / 1.08), x, y);
  }, { passive: false });
}

function resized(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage($('cropCanvas'), 0, 0, size, size);
  return c.toDataURL('image/png');
}

$('cropCancel').onclick = () => { $('cropBox').hidden = true; crop.img = null; };
$('cropSave').onclick = async () => {
  if (!crop.img) return;
  const btn = $('cropSave');
  btn.disabled = true;
  btn.textContent = '저장하는 중…';
  try {
    const icons = { 512: $('cropCanvas').toDataURL('image/png'), 192: resized(192), 180: resized(180) };
    const res = await fetch('/api/upload-icon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icons, replace: savedIcon()?.base }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `업로드 실패 (${res.status})`);
    store.set(ICON_KEY, { base: body.base });
    applyIcon(savedIcon());
    $('cropBox').hidden = true;
    crop.img = null;
    renderIconEditor();
    showIconNote();
    toast('아이콘을 저장했어요.');
  } catch (e) {
    toast(e.message || '저장하지 못했어요.');
  } finally {
    btn.disabled = false;
    btn.textContent = '이 사진으로 저장';
  }
};

$('iconReset').onclick = () => {
  store.set(ICON_KEY, null);
  applyIcon(null);
  renderIconEditor();
  showIconNote();
  toast('기본 아이콘으로 바꿨어요.');
};

function showIconNote() {
  const note = $('iconNote');
  note.innerHTML = isStandalone()
    ? '저장했어요. 이미 만든 홈 화면 아이콘은 그대로라서, <b>기존 아이콘을 길게 눌러 삭제</b>한 뒤 <b>브라우저에서 이 사이트를 열어 다시 추가</b>해 주세요.'
    : '저장했어요. 아래 <b>홈 화면에 아이콘 저장</b>으로 추가하면 새 아이콘이 생겨요. 이미 추가한 아이콘이 있으면 먼저 삭제해 주세요.';
  note.hidden = false;
}

// ---------- 자주 가는 정류소 관리 ----------
function renderFavSettings(list) {
  const ul = $('favList');
  ul.innerHTML = '';
  list.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="fav-name">${favLabel(f)}${f.dir ? `<small>→ ${esc(f.dir)} 방면${f.route ? '' : ' · 전체 노선'}</small>` : ''}</span>
      <button class="mini" data-act="up" aria-label="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="mini" data-act="down" aria-label="아래로" ${i === list.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="mini del" data-act="del" aria-label="삭제">✕</button>`;
    li.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const l = favs();
        if (b.dataset.act === 'del') l.splice(i, 1);
        else {
          const j = b.dataset.act === 'up' ? i - 1 : i + 1;
          [l[i], l[j]] = [l[j], l[i]];
        }
        saveFavs(l);
      };
    });
    ul.append(li);
  });
  if (!list.length) ul.innerHTML = '<li class="muted">아직 저장된 정류소가 없어요. 위에서 추가하세요.</li>';
  $('favCount').textContent = `${list.length}/${MAX_FAVS}`;
  const full = list.length >= MAX_FAVS;
  $('addBox').hidden = full;
  $('addFull').hidden = !full;
}

let addStop = null, addRoute = null, addData = null, addSeq = 0;
function resetAdd() {
  addStop = null; addRoute = null; addData = null; addSeq++;
  $('addPicked').hidden = true;
  $('addRoutes').innerHTML = '';
  $('addBtn').disabled = true;
  $('sq').value = '';
}
function renderAddRoutes() {
  const box = $('addRoutes');
  box.innerHTML = '';
  const mk = (label, name, color) => {
    const b = document.createElement('button');
    b.className = 'line-tab' + (name === addRoute ? ' on' : '');
    if (color) b.style.setProperty('--c', color);
    b.textContent = label;
    b.onclick = () => { addRoute = name; renderAddRoutes(); };
    box.append(b);
  };
  mk('전체 노선', null, null);
  if (!addData) { box.insertAdjacentHTML('beforeend', '<span class="muted-s">노선 불러오는 중…</span>'); return; }
  for (const r of addData.routes) mk(r.name, r.name, r.color);
}
async function pickAdd(s) {
  const my = ++addSeq;
  addStop = { arsId: s.arsId, name: s.name, dir: s.dir || '' };
  addRoute = null; addData = null;
  $('addStop').textContent = `${s.name} (${s.arsId})`;
  $('addDir').textContent = s.dir ? `→ ${s.dir} 방면` : '';
  $('addPicked').hidden = false;
  $('addBtn').disabled = false;
  renderAddRoutes();
  try {
    const d = await arrivalsApi(s.arsId);
    if (my !== addSeq) return;
    addData = d;
    addStop.name = d.name || addStop.name;
    addStop.dir = d.direction || addStop.dir;
    $('addDir').textContent = addStop.dir ? `→ ${addStop.dir} 방면` : '';
  } catch (e) {
    if (my !== addSeq) return;
    addData = { routes: [] };
    toast(e.message || '노선을 불러오지 못했어요.');
  }
  renderAddRoutes();
}
makeSearch($('sq'), $('ssuggest'), pickAdd, (s) => openMap({ mode: 'pick', focus: s, onPick: pickAdd }));
$('addMapBtn').onclick = () => openMap({ mode: 'pick', onPick: pickAdd });
$('addBtn').onclick = () => {
  if (!addStop) return;
  const r = addData?.routes.find((x) => x.name === addRoute);
  if (addFav({ ...addStop, route: addRoute, color: r?.color || null })) resetAdd();
};

// ======================================================================
// 시작
// ======================================================================
{
  const qs = new URLSearchParams(location.search);
  history.replaceState({ view: 'home' }, '', location.pathname + location.search);
  showHome();
  if (/^\d{5}$/.test(qs.get('stop') || '')) {
    // 주소로 바로 열기 (?stop=22009&route=140): 뒤로가기하면 처음 화면으로
    openStop(qs.get('stop'), { route: qs.get('route') || null });
  }
  configReady.then(() => {
    if (config.demo) {
      $('demoNote').textContent = '⚠ 지금은 예시 데이터로 동작 중이에요. 버스 인증키를 설정하면 실제 도착 정보가 나와요.';
      $('demoNote').hidden = false;
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
