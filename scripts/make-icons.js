// 기본 앱 아이콘 PNG 생성: node scripts/make-icons.js
// (사용자 사진 아이콘은 /api/upload-icon 으로 따로 저장)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon, DEFAULT_ICON } from '../lib/icon.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true], // iOS는 자체적으로 모서리를 둥글게 처리
];
for (const [name, size, mask] of targets) {
  fs.writeFileSync(path.join(out, name), renderIcon(size, { ...DEFAULT_ICON, mask }));
  console.log('wrote', name);
}
