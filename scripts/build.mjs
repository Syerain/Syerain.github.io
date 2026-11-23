#!/usr/bin/env node
// 构建入口：内容编译 → 启动 WordPress Playground → 抓取静态化 → 落到 dist/
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { markdownToBlocks, splitFrontMatter } from '../lib/markdown.mjs';
import { coverPng } from '../lib/png.mjs';
import { exportStaticSite } from './export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const SEED_DIR = path.join(CACHE, 'seed');
const log = (...a) => console.log(...a);

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

async function listMarkdown(dir) {
	let names = [];
	try {
		names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md'));
	} catch {
		return [];
	}
	const items = [];
	for (const name of names) {
		const raw = await fs.readFile(path.join(dir, name), 'utf8');
		const { data, body } = splitFrontMatter(raw);
		items.push({
			file: name,
			slug: data.slug || name.replace(/\.md$/, ''),
			title: data.title || name.replace(/\.md$/, ''),
			date: data.date || '2024-01-01 00:00:00',
			excerpt: data.excerpt || '',
			category: data.category || '',
			tags: (Array.isArray(data.tags) ? data.tags : data.tags ? String(data.tags).split(',') : [])
				.map((t) => String(t).trim())
				.filter(Boolean)
				.map((t) => {
					const [name, slug] = t.split('|');
					return { name: name.trim(), slug: (slug || '').trim() };
				}),
			cover: data.cover || '',
			menuOrder: Number(data.menuOrder || 0),
			content: markdownToBlocks(body),
		});
	}
	return items;
}

/** 找一个空闲端口 */
function freePort(start = 9400) {
	return new Promise((resolve) => {
		const tryPort = (p) => {
			const srv = net.createServer();
			srv.once('error', () => tryPort(p + 1));
			srv.once('listening', () => srv.close(() => resolve(p)));
			srv.listen(p, '127.0.0.1');
		};
		tryPort(start);
	});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	const t0 = Date.now();

	/* ---------- 1. 内容 ---------- */
	const site = await readJson(path.join(ROOT, 'content/site.json'));
	const posts = (await listMarkdown(path.join(ROOT, 'content/posts'))).sort((a, b) =>
		a.date < b.date ? 1 : -1
	);
	const pages = (await listMarkdown(path.join(ROOT, 'content/pages'))).sort(
		(a, b) => a.menuOrder - b.menuOrder
	);

	await fs.rm(SEED_DIR, { recursive: true, force: true });
	await fs.mkdir(path.join(SEED_DIR, 'covers'), { recursive: true });

	// 封面：front matter 里写 cover: 文件名（content/covers/ 下）则用真图，否则生成抽象渐变图
	posts.forEach((p, i) => {
		let coverName = String(i + 1);
		let coverExt = 'png';
		const custom = String(p.cover || '').trim();
		const customPath = path.join(ROOT, 'content/covers', custom);
		if (custom && /\.(png|jpe?g)$/i.test(custom) && fss.existsSync(customPath)) {
			coverExt = path.extname(custom).slice(1).toLowerCase();
			coverName = `c-${i + 1}`;
			fss.copyFileSync(customPath, path.join(SEED_DIR, 'covers', `${coverName}.${coverExt}`));
		} else {
			fss.writeFileSync(path.join(SEED_DIR, 'covers', `${coverName}.png`), coverPng(i + 1));
		}
		p.coverFile = coverName;
		p.coverExt = coverExt;
	});

	const seed = {
		site: { ...site, postsPerPage: site.postsPerPage || 10 },
		posts: posts.map((p, i) => ({
			title: p.title,
			slug: p.slug,
			date: p.date,
			excerpt: p.excerpt,
			category: p.category,
			tags: p.tags,
			cover: p.coverFile,
			coverExt: p.coverExt,
			content: p.content,
		})),
		pages: pages.map((p) => ({
			title: p.title,
			slug: p.slug,
			date: p.date,
			excerpt: p.excerpt,
			content: p.content,
			menuOrder: p.menuOrder,
		})),
	};
	await fs.writeFile(path.join(SEED_DIR, 'seed.json'), JSON.stringify(seed, null, '\t'), 'utf8');
	log(`内容：${posts.length} 篇文章 / ${pages.length} 个页面`);

	/* ---------- 2. 蓝图 ---------- */
	const port = await freePort(Number(process.env.PORT || 9400));
	const origin = `http://127.0.0.1:${port}`;
	const seedPhp = await fs.readFile(path.join(ROOT, 'scripts/playground/seed.php'), 'utf8');
	const blueprint = {
		$schema: 'https://playground.wordpress.net/blueprint-schema.json',
		landingPage: '/',
		preferredVersions: { php: '8.3', wp: process.env.WP_VERSION || '6.7' },
		steps: [
			{ step: 'activateTheme', themeFolderName: 'twentytwentythree' },
			{ step: 'runPHP', code: seedPhp },
		],
	};
	const blueprintPath = path.join(CACHE, 'blueprint.json');
	await fs.writeFile(blueprintPath, JSON.stringify(blueprint, null, 2), 'utf8');

	/* ---------- 3. 启动 Playground ---------- */
	const cli = path.join(ROOT, 'node_modules/@wp-playground/cli/wp-playground.js');
	const args = [
		cli,
		'server',
		`--port=${port}`,
		`--site-url=${origin}`,
		`--verbosity=${process.env.PW_VERBOSITY || 'quiet'}`,
		// 安装后再挂载：WP 核心包里自带的 twentytwentythree 会被我们的目录覆盖
		'--mount-dir',
		path.join(ROOT, 'theme/twentytwentythree'),
		'/wordpress/wp-content/themes/twentytwentythree',
		'--mount-dir',
		SEED_DIR,
		'/wordpress/wp-content/uploads/seed',
		`--blueprint=${blueprintPath}`,
	];

	const logPath = path.join(CACHE, 'playground.log');
	fss.mkdirSync(CACHE, { recursive: true });
	const out = fss.createWriteStream(logPath);
	log(`启动 WordPress Playground（端口 ${port}）…`);

	const child = spawn(process.execPath, args, {
		cwd: ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, NODE_ENV: 'production' },
	});
	child.stdout.pipe(out);
	child.stderr.pipe(out);

	let exited = false;
	child.on('exit', (code) => {
		exited = true;
		if (code !== 0) log(`Playground 退出，代码 ${code}（日志：${logPath}）`);
	});

	const cleanup = () => {
		if (process.platform === 'win32') {
			try {
				spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
			} catch {}
		} else {
			try {
				child.kill('SIGKILL');
			} catch {}
		}
	};
	process.on('exit', cleanup);
	process.on('SIGINT', () => {
		cleanup();
		process.exit(130);
	});

	/* ---------- 4. 等待就绪（HTTP + 种子完成标记） ---------- */
	const marker = path.join(SEED_DIR, '.seeded');
	await fs.rm(marker, { force: true });
	const deadline = Date.now() + 240000;
	let ready = false;
	while (Date.now() < deadline) {
		if (exited) break;
		const seeded = fss.existsSync(marker);
		let up = false;
		try {
			const res = await fetch(origin + '/', { redirect: 'manual' });
			up = res.status === 200;
		} catch {}
		if (up && seeded) {
			ready = true;
			break;
		}
		await wait(700);
	}
	if (!ready) {
		const tail = fss.existsSync(logPath) ? fss.readFileSync(logPath, 'utf8').slice(-4000) : '';
		console.error('WordPress 启动/播种失败，日志尾部：\n' + tail);
		cleanup();
		process.exit(1);
	}
	// 校验：固定链接与模板已生效（否则抓到的会是首页内容）。
	// 不自己拼 URL——WP 会净化 slug（ASCII 小写、空格转连字符），直接取首页上 WP 生成的第一条文章链接来探测。
	const homeHtml = await (await fetch(origin + '/')).text();
	const firstPostHref = /<h2 class="wp-block-post-title"><a href="([^"]+)"/.exec(homeHtml)?.[1];
	if (posts.length && !firstPostHref) {
		console.error('模板校验失败：首页没有渲染出任何文章链接');
		cleanup();
		process.exit(1);
	}
	if (firstPostHref) {
		const body = await (await fetch(firstPostHref)).text();
		if (!body.includes('wp-block-post-content')) {
			console.error(`模板校验失败：${firstPostHref} 未渲染 single 模板（固定链接可能未生效）`);
			cleanup();
			process.exit(1);
		}
	}
	log(`WordPress 就绪（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

	/* ---------- 5. 静态化 ---------- */
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

	const result = await exportStaticSite({
		origin,
		outDir: path.join(ROOT, 'dist'),
		basePath,
		meta: {
			title: site.title,
			description: site.description,
			language: site.language,
			homeHeading: site.homeHeading || '',
			ctaText: site.ctaText || '',
			ctaButton: site.ctaButton || '',
			siteUrl: site.siteUrl,
			customDomain: site.customDomain,
			ogImage: '',
			posts: posts.map((p) => ({
				slug: p.slug,
				title: p.title,
				excerpt: p.excerpt,
				date: String(p.date).slice(0, 10),
			})),
		},
	});

	cleanup();
	await new Promise((r) => setTimeout(r, 300));

	log('');
	log('构建完成');
	log(`  页面 ${result.pages} 个 · 资源 ${result.assets} 个 · CSS ${result.cssKb} KB`);
	log(`  输出目录：dist/（basePath=${basePath || '/'}）`);
	log(`  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
