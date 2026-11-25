// 의존성 없이 앱 아이콘 PNG를 그리는 모듈
// - shape: 그림 종류, bg: 배경색, mask: true면 안드로이드 maskable(가장자리까지 꽉 채움)
import zlib from 'node:zlib';

export const SHAPES = ['bus', 'train', 'clock', 'pin', 'star', 'home', 'heart'];
export const DEFAULT_ICON = { shape: 'bus', bg: '13804f' };

const WHITE = [255, 255, 255];
const YELLOW = [255, 200, 61];

const hexToRgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));

// 배경이 밝으면 그림을 어두운 색으로
function fgFor(bg) {
  const [r, g, b] = bg;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.72 ? [30, 34, 40] : WHITE;
}

// ---------- 도형 판정 (좌표 0..1) ----------
function inRRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
// 선분과의 거리 ≤ w/2
function nearSeg(x, y, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (w / 2) ** 2;
}
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 0.17 : 0.4;
  return [0.5 + r * Math.cos(a), 0.53 + r * Math.sin(a)];
});

// 그림 색을 돌려줌. null이면 배경
function drawShape(shape, u, v, fg, bg) {
  switch (shape) {
    case 'clock': {
      if (inCircle(u, v, 0.5, 0.5, 0.36)) {
        if (!inCircle(u, v, 0.5, 0.5, 0.3)) return fg;              // 테두리
        if (nearSeg(u, v, 0.5, 0.5, 0.5, 0.29, 0.055)) return fg;   // 분침
        if (nearSeg(u, v, 0.5, 0.5, 0.64, 0.58, 0.055)) return fg;  // 시침
        if (inCircle(u, v, 0.5, 0.5, 0.04)) return YELLOW;
        return null;
      }
      return null;
    }
    case 'pin': {
      const inHead = inCircle(u, v, 0.5, 0.4, 0.27);
      const inTail = inPolygon(u, v, [[0.27, 0.5], [0.73, 0.5], [0.5, 0.88]]);
      if (inHead || inTail) return inCircle(u, v, 0.5, 0.4, 0.11) ? bg : fg;
      return null;
    }
    case 'star':
      return inPolygon(u, v, STAR) ? fg : null;
    case 'home': {
      if (inPolygon(u, v, [[0.5, 0.14], [0.86, 0.48], [0.14, 0.48]])) return fg; // 지붕
      if (inRRect(u, v, 0.23, 0.45, 0.77, 0.84, 0.03)) {
        if (inRRect(u, v, 0.43, 0.6, 0.57, 0.84, 0.02)) return bg;   // 문
        return fg;
      }
      return null;
    }
    case 'heart': {
      const x = (u - 0.5) / 0.33, y = (0.47 - v) / 0.33; // 하트 방정식
      return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0 ? fg : null;
    }
    case 'bus': {
      // 바퀴
      if (inCircle(u, v, 0.33, 0.8, 0.075) || inCircle(u, v, 0.67, 0.8, 0.075)) return inCircle(u, v, 0.33, 0.8, 0.03) || inCircle(u, v, 0.67, 0.8, 0.03) ? bg : fg;
      // 사이드 미러
      if (inRRect(u, v, 0.15, 0.27, 0.2, 0.4, 0.02) || inRRect(u, v, 0.8, 0.27, 0.85, 0.4, 0.02)) return fg;
      if (inRRect(u, v, 0.21, 0.13, 0.79, 0.78, 0.09)) {
        if (inRRect(u, v, 0.27, 0.27, 0.73, 0.5, 0.04)) return bg;          // 앞 유리
        if (inRRect(u, v, 0.36, 0.17, 0.64, 0.22, 0.02)) return bg;         // 노선 표시판
        if (inCircle(u, v, 0.32, 0.64, 0.045) || inCircle(u, v, 0.68, 0.64, 0.045)) return YELLOW; // 전조등
        if (v > 0.69 && v < 0.715 && u > 0.42 && u < 0.58) return bg;       // 그릴
        return fg;
      }
      return null;
    }
    case 'train':
    default: {
      if (v > 0.86 && v < 0.9 && u > 0.18 && u < 0.82) return fg;  // 레일
      if ((u > 0.3 && u < 0.36 || u > 0.64 && u < 0.7) && v > 0.74 && v < 0.87) return fg;
      if (inRRect(u, v, 0.24, 0.14, 0.76, 0.78, 0.1)) {
        if (inRRect(u, v, 0.31, 0.24, 0.69, 0.48, 0.04)) return bg;  // 앞 유리
        if (inCircle(u, v, 0.35, 0.64, 0.045) || inCircle(u, v, 0.65, 0.64, 0.045)) return YELLOW;
        if (v > 0.18 && v < 0.2 && u > 0.42 && u < 0.58) return bg;
        return fg;
      }
      return null;
    }
  }
}

function pixel(x, y, opt) {
  const s = opt.mask ? 0.78 : 0.9;      // maskable은 안전영역 안에 그림
  const u = (x - 0.5) / s + 0.5, v = (y - 0.5) / s + 0.5;
  if (!opt.mask && !inRRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) return null; // 둥근 배경 밖 = 투명
  return drawShape(opt.shape, u, v, opt.fgRgb, opt.bgRgb) || opt.bgRgb;
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 입력값 검증 + 기본값
export function normalizeIcon({ shape, bg } = {}) {
  return {
    shape: SHAPES.includes(shape) ? shape : DEFAULT_ICON.shape,
    bg: /^[0-9a-f]{6}$/i.test(bg || '') ? bg.toLowerCase() : DEFAULT_ICON.bg,
  };
}

export function renderIcon(size, { shape, bg, mask = false }) {
  const ic = normalizeIcon({ shape, bg });
  const bgRgb = hexToRgb(ic.bg);
  const opt = { shape: ic.shape, mask, bgRgb, fgRgb: fgFor(bgRgb) };
  const SS = size > 256 ? 2 : 3; // 안티앨리어싱 (큰 이미지는 덜 샘플링해도 충분)
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opt);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = (py * size + px) * 4;
      out[o] = a ? r / a : 0; out[o + 1] = a ? g / a : 0; out[o + 2] = a ? b / a : 0;
      out[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return encodePng(size, out);
}
