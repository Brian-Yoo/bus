// 로컬 개발 서버: public/ 정적 파일 + api/*.js 함수 실행
// 사용법: npm run dev  (.env 파일에 BUS_API_KEY=... 작성, 없으면 예시 데이터)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// .env 로드 (의존성 없이)
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// 로컬에서는 사진 아이콘을 .local-uploads 폴더에 저장 (Blob 연결 변수가 .env에 있으면 그쪽 사용)
process.env.LOCAL_DEV = '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    // vercel.json rewrites와 같게: /icon-img/<id>/<크기>.png → api/icon-img.js
    const im = /^\/icon-img\/([0-9a-f-]+)\/(\d+)\.png$/.exec(url.pathname);
    if (im) {
      req.query = { id: im[1], size: im[2] };
      const mod = await import(pathToFileURL(path.join(root, 'api', 'icon-img.js')).href);
      return await mod.default(req, res);
    }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
      const file = path.join(root, 'api', `${name}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    const base = path.join(root, 'public');
    let p = path.normalize(path.join(base, decodeURIComponent(url.pathname)));
    if (!p.startsWith(base)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end(String(e));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
