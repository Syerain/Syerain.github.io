#!/usr/bin/env node
// 本地预览：按部署时的 basePath 提供 dist/ 的静态服务。
// 用法：node scripts/preview.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const site = JSON.parse(await fsp.readFile(path.join(ROOT, 'content/site.json'), 'utf8'));
const basePath =
	process.env.BASE_PATH !== undefined
		? process.env.BASE_PATH
		: (() => {
				try {
					return new URL(site.siteUrl).pathname || '/';
				} catch {
					return '/';
				}
			})();
const base = basePath === '/' ? '' : `/${basePath.replace(/^\/|\/$/g, '')}`;
const port = Number(process.argv[2] || process.env.PORT || 4321);

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8',
};

http
	.createServer(async (req, res) => {
		let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
		if (base && !urlPath.startsWith(base)) {
			res.writeHead(302, { location: base + '/' });
			return res.end();
		}
		urlPath = urlPath.slice(base.length) || '/';

		const candidates = urlPath.endsWith('/')
			? [urlPath + 'index.html']
			: [urlPath, urlPath + '/index.html', urlPath + '.html'];
		for (const cand of candidates) {
			const file = path.join(DIST, cand);
			if (!file.startsWith(DIST)) break;
			try {
				const buf = await fsp.readFile(file);
				res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
				return res.end(buf);
			} catch {}
		}
		const notFound = path.join(DIST, '404.html');
		if (fs.existsSync(notFound)) {
			res.writeHead(404, { 'content-type': MIME['.html'] });
			return res.end(await fsp.readFile(notFound));
		}
		res.writeHead(404).end('404');
	})
	.listen(port, '127.0.0.1', () => {
		console.log(`预览： http://127.0.0.1:${port}${base}/`);
		console.log(`（dist/ 以 basePath=${base || '/'} 提供，与 GitHub Pages 的行为一致）`);
	});
