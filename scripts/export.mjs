// 把本地 WordPress（Playground）渲染出的站点抓成纯静态站点。
// 思路：真 WordPress 负责渲染（100% 保真），Node 负责把 HTML/CSS/图片落盘并改写链接。
import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP_LINK = /^\/(wp-admin|wp-login|wp-json|xmlrpc|wp-content\/plugins|wp-includes|feed$|comments\/feed)/i;
const okExt = (p) => p === '' || /\.html?$/i.test(p) || !/\.[a-z0-9]{2,5}$/i.test(p);

/** 带重试的 GET */
async function get(url, { as = 'text', tries = 3 } = {}) {
	for (let i = 0; i < tries; i++) {
		try {
			const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'tt3-static-exporter' } });
			const body = as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
			return { status: res.status, body, headers: res.headers };
		} catch (e) {
			if (i === tries - 1) throw e;
			await new Promise((r) => setTimeout(r, 300 * (i + 1)));
		}
	}
}

/** 拆 CSS 规则（花括号配平），用于跨页去重 */
function splitRules(css) {
	const out = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}') {
			depth--;
			if (depth === 0) {
				out.push(css.slice(start, i + 1).trim());
				start = i + 1;
			}
		}
	}
	const tail = css.slice(start).trim();
	if (tail) out.push(tail);
	return out.filter(Boolean);
}

/** 删除配对的元素（按 class 定位起始标签），支持同名嵌套 */
function removeElement(html, opener) {
	const idx = html.search(opener);
	if (idx < 0) return html;
	const tag = /^<([a-z0-9-]+)/i.exec(html.slice(idx))[1];
	const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
	re.lastIndex = idx;
	let depth = 0;
	let m;
	while ((m = re.exec(html))) {
		if (m[1] === '/') depth--;
		else if (!m[0].endsWith('/>')) depth++;
		if (depth === 0) return html.slice(0, idx) + html.slice(re.lastIndex);
	}
	return html;
}

const isAbsolute = (u) => /^(?:[a-z]+:|\/\/|#|mailto:|tel:|data:)/i.test(u);

function urlToOutPath(urlPath) {
	let p = decodeURIComponent(urlPath.split('#')[0].split('?')[0]);
	if (p === '' || p === '/') return 'index.html';
	if (p.endsWith('/')) return `${p.slice(1)}index.html`;
	if (!/\.[a-z0-9]{1,5}$/i.test(p)) return `${p.slice(1)}/index.html`;
	return p.slice(1);
}

/**
 * @param {object} opts
 * @param {string} opts.origin  本地 WP 地址，如 http://127.0.0.1:9400
 * @param {string} opts.outDir  输出目录
 * @param {string} opts.basePath 部署子路径（'/' 或 '/repo/'）
 * @param {object} opts.meta    { title, description, language, siteUrl, customDomain, posts:[{slug,title,excerpt,date}] }
 */
export async function exportStaticSite(opts) {
	const { origin, outDir, meta } = opts;
	const base = !opts.basePath || opts.basePath === '/' ? '/' : `/${opts.basePath.replace(/^\/|\/$/g, '')}/`;
	const log = (...a) => console.log('  ', ...a);

	await fs.rm(outDir, { recursive: true, force: true });
	await fs.mkdir(outDir, { recursive: true });

	// ---------- 1. 抓取 ----------
	const queue = ['/'];
	const seen = new Set();
	const pages = [];
	const MAX_PAGES = Number(process.env.MAX_PAGES || 80);

	while (queue.length && pages.length < MAX_PAGES) {
		const urlPath = queue.shift();
		if (seen.has(urlPath)) continue;
		seen.add(urlPath);
		const res = await get(origin + urlPath);
		const html = res.body;
		pages.push({ urlPath, html, status: res.status });
		if (process.env.DUMP_RAW) {
			const f = path.join(process.env.DUMP_RAW, `${urlPath.replace(/[^a-z0-9]+/gi, '_') || 'root'}.html`);
			await fs.mkdir(process.env.DUMP_RAW, { recursive: true });
			await fs.writeFile(f, html, 'utf8');
		}
		log(`抓取 ${urlPath} (${res.status}, ${(html.length / 1024).toFixed(1)} KB)`);

		for (const m of html.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"]/gi)) {
			let href = m[1];
			if (isAbsolute(href) && !href.startsWith(origin)) continue;
			if (href.startsWith(origin)) href = href.slice(origin.length);
			href = href.split('#')[0];
			if (!href || !href.startsWith('/')) continue;
			if (SKIP_LINK.test(href)) continue;
			if (href.includes('?')) continue;
			if (!okExt(href)) continue;
			if (seen.has(href)) continue;
			queue.push(href);
		}
	}

	// 404：WP 对不存在的地址返回 404 状态 + 404 模板
	const notFound = await get(`${origin}/__missing__/`);
	pages.push({ urlPath: '/__missing__/', html: notFound.body, status: 404, is404: true });

	// ---------- 2. 汇总 CSS / 资源 ----------
	const cssRules = new Map(); // rule -> true（保序）
	const externalSheets = new Set();
	const assets = new Map(); // 站点相对路径 -> Buffer

	const addCss = (css, sourceUrl = '/') => {
		// 把相对 url() 解析成站点绝对路径，并登记资源
		const resolved = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, q, u) => {
			if (isAbsolute(u)) return full;
			const abs = u.startsWith('/') ? u : new URL(u, 'http://x' + sourceUrl).pathname;
			assets.set(abs, null);
			return `url(${q}${base.replace(/\/$/, '')}${abs}${q})`;
		});
		for (const rule of splitRules(resolved)) if (!cssRules.has(rule)) cssRules.set(rule, true);
	};

	// ---------- 3. 逐页转换 ----------
	const out = [];
	const pageTitleRe = /<title>([\s\S]*?)<\/title>/i;
	const metaDescRe = /<meta name="description" content="([^"]*)"/i;

	for (const page of pages) {
		let html = page.html;

		// 内联样式收集
		for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) addCss(m[1], page.urlPath);
		// 外链样式收集
		for (const m of html.matchAll(/<link[^>]*rel=['"]stylesheet['"][^>]*>/gi)) {
			const href = /href=['"]([^'"]+)['"]/i.exec(m[0])?.[1];
			if (!href) continue;
			const p = href.startsWith(origin) ? href.slice(origin.length) : href;
			if (!p.startsWith('/')) continue;
			externalSheets.add(p.split('?')[0]);
		}

		// 剥离：所有 link / script / style
		html = html
			.replace(/<link\b[^>]*>/gi, '')
			.replace(/<script\b[\s\S]*?<\/script>/gi, '')
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
			.replace(/<style\b[^>]*\/>/gi, '')
			.replace(/<meta\s+name=["']generator["'][^>]*>/gi, '');

		// 评论表单在静态站不可用 → 换成说明；同时去掉回复链接
		html = removeElement(html, /<div[^>]*wp-block-post-comments-form[^>]*>/);
		html = html.replace(/<a\b[^>]*class=['"][^'"]*comment-reply-link[^'"]*['"][^>]*>[\s\S]*?<\/a>/gi, '');
		if (/wp-block-comments|wp-block-comment-template/.test(html)) {
			html = html.replace(
				/(<div class="wp-block-comments[^"]*">)/,
				'$1<div class="tt3-static-note"><p>评论已关闭。静态站点没有后端，需要互动可以接入 Giscus / Utterances。</p></div>'
			);
		}

		// 页脚署名
		html = html.replace(
			/Proudly powered by\s*<a href="https:\/\/wordpress\.org" rel="nofollow">WordPress<\/a>/i,
			'Static export of <a href="https://wordpress.org/themes/twentytwentythree/" rel="nofollow">Twenty Twenty-Three</a>'
		);

		// 界面文案本地化：等价于给主题装语言包，只替换渲染出的固定字符串
		if (meta.language === 'zh-CN') {
			const label = (from, to) => {
				html = html.split(from).join(to);
			};
			label('Mindblown: a blog about philosophy.', meta.homeHeading || meta.description);
			label('Got any book recommendations?', meta.ctaText || '有想推荐的吗？');
			label('Get In Touch', meta.ctaButton || '来聊聊');
			label('Next Page', '下一页');
			label('Previous Page', '上一页');
			label('>Comments<', '>评论<');
			html = html.replace(/>(\d+) Comments?</g, '>$1 条评论<');
			label('Page not found', '页面不存在');
			label('This page could not be found.', '你要找的页面不在这里。');
			label('placeholder="Search..."', 'placeholder="搜索…"');
			// post-meta 的小标签（标记里有缩进，需要容忍空白）
			html = html.replace(/(<p[^>]*>)\s*Posted\s*(<\/p>)/g, '$1发布于$2');
			html = html.replace(/(<p[^>]*>)\s*in\s*(<\/p>)/g, '$1分类$2');
			html = html.replace(/(<p[^>]*>)\s*by\s*(<\/p>)/g, '$1作者$2');
			html = html.replace(/(<p[^>]*>)\s*Tags:\s*(<\/p>)/g, '$1标签：$2');
			// 评论计数标题："2 responses to “标题”"
			html = html.replace(/(\d+) responses to &#8220;/g, '$1 条评论 · &#8220;');
			html = html.replace(/Category:\s*/g, '分类：');
			html = html.replace(/Tag:\s*/g, '标签：');
			html = html.replace(/&#8211; Page (\d+) &#8211;/g, '&#8211; 第 $1 页 &#8211;');
		}

		// 搜索表单 → 静态搜索页
		html = html.replace(/(<form\b[^>]*method=['"]get['"][^>]*action=['"])[^'"]*(['"])/gi, `$1${base}search/$2`);
		html = html.replace(/<form\b([^>]*)role=['"]search['"]([^>]*)>/gi, (full) =>
			full.replace(/action=['"][^'"]*['"]/i, `action="${base}search/"`)
		);

		// 站内绝对链接 → 加 base 前缀
		html = html.replace(/\b(href|src|action)=['"]([^'"]+)['"]/gi, (full, attr, val) => {
			if (val.startsWith(origin)) return `${attr}="${base.replace(/\/$/, '')}${val.slice(origin.length)}"`;
			if (val.startsWith('/') && !val.startsWith('//')) return `${attr}="${base.replace(/\/$/, '')}${val}"`;
			return full;
		});
		html = html.replace(/\bsrcset=['"]([^'"]+)['"]/gi, (full, val) => {
			const rewritten = val
				.split(',')
				.map((part) => {
					const [u, ...d] = part.trim().split(/\s+/);
					let url = u.startsWith(origin) ? u.slice(origin.length) : u;
					if (url.startsWith('/')) url = base.replace(/\/$/, '') + url;
					return [url, ...d].join(' ');
				})
				.join(', ');
			return `srcset="${rewritten}"`;
		});

		// 资源登记（图片等）
		for (const m of html.matchAll(/<img\b[^>]*\bsrc=['"]([^'"]+)['"]/gi)) {
			const p = m[1].startsWith(base.replace(/\/$/, '')) ? m[1].slice(base.replace(/\/$/, '').length) : m[1];
			if (p.startsWith('/')) assets.set(p.split('?')[0], null);
		}
		for (const m of html.matchAll(/\bsrcset=['"]([^'"]+)['"]/gi)) {
			for (const part of m[1].split(',')) {
				let u = part.trim().split(/\s+/)[0];
				if (!u) continue;
				if (u.startsWith(base.replace(/\/$/, ''))) u = u.slice(base.replace(/\/$/, '').length);
				if (u.startsWith('/')) assets.set(u.split('?')[0], null);
			}
		}

		// 语言 / SEO 注入
		// （CTA 按钮在主题里没有目标地址；放在 URL 改写之后注入，避免 base 被叠加两次）
		html = html.replace(
			/<a class="wp-block-button__link wp-element-button">/g,
			`<a class="wp-block-button__link wp-element-button" href="${base}contact/">`
		);
		const lang = meta.language || 'en-US';
		html = html.replace(/<html\b[^>]*>/i, `<html lang="${lang}">`);
		const title = pageTitleRe.exec(page.html)?.[1]?.trim() || meta.title;
		const desc =
			(metaDescRe.exec(page.html)?.[1] || '').trim() ||
			`${meta.description}`.slice(0, 160).replace(/"/g, '&quot;');
		const canonical = `${(meta.siteUrl || '').replace(/\/$/, '')}${page.is404 ? '/404.html' : page.urlPath}`;
		const cover = meta.ogImage ? `${(meta.siteUrl || '').replace(/\/$/, '')}${base}${meta.ogImage}` : '';
		const head = [
			`<meta name="description" content="${desc.replace(/"/g, '&quot;')}" />`,
			`<link rel="canonical" href="${canonical || page.urlPath}" />`,
			`<meta property="og:type" content="${page.urlPath === '/' ? 'website' : 'article'}" />`,
			`<meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />`,
			`<meta property="og:description" content="${desc.replace(/"/g, '&quot;')}" />`,
			`<meta property="og:url" content="${canonical || page.urlPath}" />`,
			cover ? `<meta property="og:image" content="${cover}" />` : '',
			`<meta name="twitter:card" content="summary_large_image" />`,
			`<link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />`,
			`<link rel="stylesheet" href="${base}assets/css/site.css" />`,
			`<script defer src="${base}assets/js/static.js"></script>`,
		]
			.filter(Boolean)
			.join('\n');
		html = html.replace(/<\/head>/i, `${head}\n</head>`);

		const outPath = page.is404 ? '404.html' : urlToOutPath(page.urlPath);
		out.push({ outPath, html, urlPath: page.urlPath });
	}

	// ---------- 4. 外链样式表 ----------
	for (const sheet of externalSheets) {
		const res = await get(origin + sheet);
		if (res.status !== 200) {
			log(`跳过样式表 ${sheet} (${res.status})`);
			continue;
		}
		addCss(res.body, sheet);
	}

	// ---------- 5. 下载资源 ----------
	const assetPaths = [...assets.keys()].filter((p) => !/\.css$/i.test(p));
	let saved = 0;
	const queueAssets = [...assetPaths];
	// CSS 里引用的 url() 也要落盘（字体等）
	while (queueAssets.length) {
		const p = queueAssets.shift();
		if (assets.get(p)) continue;
		let res;
		try {
			res = await get(origin + p, { as: 'buffer' });
		} catch (e) {
			log(`资源失败 ${p}: ${e.message}`);
			assets.set(p, Buffer.alloc(0));
			continue;
		}
		if (res.status !== 200) {
			log(`资源 ${p} -> ${res.status}`);
			assets.set(p, Buffer.alloc(0));
			continue;
		}
		assets.set(p, res.body);
		saved++;
	}

	// ---------- 6. 搜索页 / 索引 ----------
	const posts = meta.posts || [];
	const searchIndex = posts.map((p) => ({
		title: p.title,
		url: `${base}${p.slug}/`,
		excerpt: (p.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 160),
		date: p.date || '',
	}));
	await fs.mkdir(path.join(outDir, 'assets/js'), { recursive: true });
	await fs.writeFile(path.join(outDir, 'assets/js/search-index.js'), `window.TT3_INDEX=${JSON.stringify(searchIndex)};\n`, 'utf8');

	const shellPage = out.find((p) => p.urlPath === '/');
	if (shellPage) {
		const mainStart = shellPage.html.indexOf('<main');
		const mainEnd = shellPage.html.lastIndexOf('</main>') + '</main>'.length;
		const main = `<main class="wp-block-group has-global-padding is-layout-constrained wp-block-group-is-layout-constrained" style="margin-top:var(--wp--preset--spacing--50);margin-bottom:var(--wp--preset--spacing--70)">
	<h1 class="alignwide wp-block-heading" style="margin-bottom:var(--wp--preset--spacing--40)">搜索</h1>
	<div class="wp-block-group alignwide" style="max-width:650px">
		<div class="wp-block-search__inside-wrapper" style="display:flex;gap:8px">
			<label class="screen-reader-text" for="tt3-q">搜索关键词</label>
			<input id="tt3-q" type="search" class="wp-block-search__input" placeholder="输入关键词，例如：注意力" style="flex:1;padding:12px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit" />
		</div>
		<p id="tt3-count" class="has-small-font-size" style="margin-top:var(--wp--preset--spacing--30)"></p>
	</div>
	<ul id="tt3-results" class="is-flex-container columns-3 alignwide wp-block-post-template is-layout-flow wp-block-post-template-is-layout-flow"></ul>
</main>`;
		const searchHtml = shellPage.html.slice(0, mainStart) + main + shellPage.html.slice(mainEnd);
		out.push({
			outPath: 'search/index.html',
			urlPath: '/search/',
			html: searchHtml.replace(
				/<\/head>/i,
				`<script defer src="${base}assets/js/search-index.js"></script>\n<script defer src="${base}assets/js/search.js"></script>\n</head>`
			),
		});
	}

	// ---------- 7. 写盘 ----------
	for (const p of out) {
		const file = path.join(outDir, p.outPath);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, p.html, 'utf8');
	}
	for (const [p, buf] of assets) {
		if (!buf || !buf.length) continue;
		const file = path.join(outDir, p.slice(1));
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, buf);
	}

	const siteCss =
		[...cssRules.keys()].join('\n') +
		`
/* 静态化修正：搜索块的 label 宽度覆盖 screen-reader-text，会让 404 页横向溢出 */
.wp-block-search__label.screen-reader-text{width:1px!important}
`;
	await fs.mkdir(path.join(outDir, 'assets/css'), { recursive: true });
	await fs.writeFile(path.join(outDir, 'assets/css/site.css'), siteCss, 'utf8');
	await fs.mkdir(path.join(outDir, 'assets/js'), { recursive: true });
	await fs.writeFile(path.join(outDir, 'assets/js/static.js'), STATIC_JS, 'utf8');
	await fs.writeFile(path.join(outDir, 'assets/js/search.js'), SEARCH_JS, 'utf8');
	await fs.writeFile(path.join(outDir, 'favicon.svg'), FAVICON, 'utf8');
	await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

	// sitemap / robots
	const originUrl = (meta.siteUrl || '').replace(/\/$/, '');
	const today = new Date().toISOString().slice(0, 10);
	const urls = out
		.filter((p) => !p.outPath.startsWith('404') && !p.outPath.startsWith('search/'))
		.map((p) => `\t<url><loc>${originUrl}${p.urlPath}</loc><lastmod>${today}</lastmod></url>`)
		.join('\n');
	await fs.writeFile(
		path.join(outDir, 'sitemap.xml'),
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
		'utf8'
	);
	await fs.writeFile(
		path.join(outDir, 'robots.txt'),
		`User-agent: *\nAllow: /\n\nSitemap: ${originUrl}/sitemap.xml\n`,
		'utf8'
	);
	if (meta.customDomain) await fs.writeFile(path.join(outDir, 'CNAME'), `${meta.customDomain}\n`, 'utf8');

	const pagesCount = out.length;
	const kb = (siteCss.length / 1024).toFixed(0);
	log(`完成：${pagesCount} 个页面，${saved} 个资源，CSS ${kb} KB`);
	return { pages: pagesCount, assets: saved, cssKb: Number(kb), list: out.map((p) => p.urlPath) };
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#000"/><path d="M16 46V18h6l10 16 10-16h6v28h-6V29L32 44 22 29v17z" fill="#9DFF20"/></svg>\n`;

const STATIC_JS = `// 从 WordPress 前端脚本改为纯静态实现：只保留移动端菜单展开/收起。
(function () {
	function setOpen(nav, open) {
		var c = nav.querySelector('.wp-block-navigation__responsive-container');
		var o = nav.querySelector('.wp-block-navigation__responsive-container-open');
		if (!c) return;
		c.classList.toggle('has-modal-open', open);
		c.classList.toggle('is-menu-open', open);
		if (o) o.setAttribute('aria-expanded', open ? 'true' : 'false');
		document.documentElement.classList.toggle('has-modal-open', open);
		if (open) {
			var first = c.querySelector('a, button');
			if (first) first.focus({ preventScroll: true });
		}
	}
	document.querySelectorAll('.wp-block-navigation').forEach(function (nav) {
		var open = nav.querySelector('.wp-block-navigation__responsive-container-open');
		var close = nav.querySelector('.wp-block-navigation__responsive-container-close');
		if (open) open.addEventListener('click', function (e) { e.preventDefault(); setOpen(nav, true); });
		if (close) close.addEventListener('click', function (e) { e.preventDefault(); setOpen(nav, false); });
		var c = nav.querySelector('.wp-block-navigation__responsive-container');
		if (c) c.addEventListener('click', function (e) { if (e.target === c) setOpen(nav, false); });
	});
	document.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.querySelectorAll('.wp-block-navigation').forEach(function (n) { setOpen(n, false); }); });
})();
`;

const SEARCH_JS = `// 纯前端搜索：数据来自 assets/js/search-index.js（构建时生成）。
(function () {
	var input = document.getElementById('tt3-q');
	var list = document.getElementById('tt3-results');
	var count = document.getElementById('tt3-count');
	var data = window.TT3_INDEX || [];
	function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	function render(q) {
		q = (q || '').trim().toLowerCase();
		var hits = !q ? data : data.filter(function (p) {
			return (p.title + ' ' + p.excerpt).toLowerCase().indexOf(q) >= 0;
		});
		list.innerHTML = hits.map(function (p) {
			return '<li class="wp-block-post"><h2 class="wp-block-post-title"><a href="' + p.url + '">' + esc(p.title) + '</a></h2>' +
				'<div class="wp-block-post-excerpt"><p class="wp-block-post-excerpt__excerpt">' + esc(p.excerpt) + '</p></div>' +
				'<div class="wp-block-post-date"><time>' + esc(p.date) + '</time></div>' +
				'<div style="height:var(--wp--preset--spacing--40)" class="wp-block-spacer" aria-hidden="true"></div></li>';
		}).join('');
		count.textContent = q ? '找到 ' + hits.length + ' 条结果' : '共 ' + data.length + ' 篇文章';
	}
	var q = new URLSearchParams(location.search).get('s') || '';
	if (input) { input.value = q; input.addEventListener('input', function () { render(input.value); }); }
	render(q);
})();
`;
