#!/usr/bin/env node
// 用 Playwright 给预览站点拍几张图（同时作为回归检查：控制台报错/资源 404 会被打印）。
// 用法：node scripts/shots.mjs [baseUrl]
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4321/tt3-pages';
const OUT = 'docs/shots';

const shots = [
	{ name: 'home', url: '/', full: true },
	{ name: 'post', url: '/why-we-repeat-the-same-argument/', full: true },
	{ name: 'archive', url: '/category/ideas/', full: true },
	{ name: 'page', url: '/about/', full: true },
	{ name: 'search', url: '/search/?s=注意力', full: true },
	{ name: '404', url: '/nope/', full: true },
];

await fs.mkdir(OUT, { recursive: true });
// 优先用系统浏览器（Edge/Chrome），避免下载 chromium；都没有再回退
const launch = async () => {
	for (const channel of ['msedge', 'chrome', undefined]) {
		try {
			return await chromium.launch(channel ? { channel } : {});
		} catch (e) {
			console.log(`launch ${channel || 'bundled'} 失败：${e.message.split('\n')[0]}`);
		}
	}
	throw new Error('无法启动任何浏览器');
};
const browser = await launch();

for (const vp of [
	{ tag: 'desktop', width: 1440, height: 900, dsf: 1 },
	{ tag: 'mobile', width: 390, height: 844, dsf: 2 },
]) {
	const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
	const page = await ctx.newPage();
	const problems = [];
	page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
	page.on('requestfailed', (r) => problems.push(`failed: ${r.url()}`));
	page.on('response', (r) => {
		if (r.status() >= 400 && !r.url().endsWith('/nope/')) problems.push(`${r.status()}: ${r.url()}`);
	});

	for (const s of shots) {
		if (vp.tag === 'mobile' && !['home', 'post'].includes(s.name)) continue;
		await page.goto(base + s.url, { waitUntil: 'networkidle' });
		await page.waitForTimeout(250);
		const file = path.join(OUT, `${s.name}-${vp.tag}.png`);
		await page.screenshot({ path: file, fullPage: s.full });
		console.log('shot', file);
		if (vp.tag === 'desktop') {
			const info = await page.evaluate(() => ({
				title: document.title,
				h1: document.querySelector('h1')?.textContent?.trim().slice(0, 60),
				posts: document.querySelectorAll('.wp-block-post').length,
				overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
				bodyFont: getComputedStyle(document.body).fontFamily,
				bodySize: getComputedStyle(document.body).fontSize,
				bg: getComputedStyle(document.body).backgroundColor,
				contentWidth: document.querySelector('.wp-block-post-content, main')?.getBoundingClientRect().width,
			}));
			console.log('   ', JSON.stringify(info));
		}
	}
	if (problems.length) console.log(`[${vp.tag}] 问题：\n  ` + problems.join('\n  '));
	await ctx.close();
}

await browser.close();
