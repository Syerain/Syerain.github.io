#!/usr/bin/env node
// DOM 探针：检查导出页面的关键细节（供无图像能力的会话验证用）
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4321/tt3-pages';
const launch = async () => {
	for (const channel of ['msedge', 'chrome', undefined]) {
		try { return await chromium.launch(channel ? { channel } : {}); } catch {}
	}
	throw new Error('no browser');
};
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const checks = [
	{ url: '/', name: 'home' },
	{ url: '/why-we-repeat-the-same-argument/', name: 'post' },
	{ url: '/nope/', name: '404' },
	{ url: '/page/2/', name: 'page2' },
];

for (const c of checks) {
	await page.goto(base + c.url, { waitUntil: 'networkidle' });
	const info = await page.evaluate(() => {
		const pick = (sel) => document.querySelector(sel)?.textContent?.trim();
		// 找出横向溢出的元素
		const wide = [];
		const vw = window.innerWidth;
		if (document.documentElement.scrollWidth > vw + 1) {
			for (const el of document.querySelectorAll('body *')) {
				const r = el.getBoundingClientRect();
				if (r.right > vw + 1 || r.left < -1) {
					wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
					if (wide.length > 6) break;
				}
			}
		}
		return {
			title: document.title,
			h1: pick('h1'),
			dates: [...document.querySelectorAll('.wp-block-post-date')].slice(0, 3).map((e) => e.textContent.trim()),
			pagination: [...document.querySelectorAll('.wp-block-query-pagination a')].map((e) => `${e.textContent.trim()}→${e.getAttribute('href')}`),
			searchPlaceholder: document.querySelector('.wp-block-search__input')?.getAttribute('placeholder'),
			searchBtn: pick('.wp-block-search__button'),
			commentsHeading: [...document.querySelectorAll('.wp-block-comments h2')].map((e) => e.textContent.trim()),
			commentsNote: !!document.querySelector('.tt3-static-note'),
			excerpt: pick('.wp-block-post-excerpt__excerpt'),
			coverImgs: [...document.querySelectorAll('.wp-block-post-featured-image img')].slice(0, 2).map((i) => i.currentSrc),
			overflowEls: wide,
		};
	});
	console.log(`\n=== ${c.name} ${c.url} ===`);
	console.log(JSON.stringify(info, null, 1));
}

// 移动端菜单
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/', { waitUntil: 'networkidle' });
const openBtn = page.locator('.wp-block-navigation__responsive-container-open');
const visible = await openBtn.count() ? await openBtn.first().isVisible() : false;
if (visible) {
	await openBtn.first().click();
	await page.waitForTimeout(200);
	const open = await page.evaluate(() => {
		const c = document.querySelector('.wp-block-navigation__responsive-container');
		return { open: c.classList.contains('is-menu-open'), links: [...c.querySelectorAll('a')].map((a) => a.textContent.trim()) };
	});
	console.log('\n=== 移动端菜单 ===');
	console.log(JSON.stringify(open));
}

await browser.close();
