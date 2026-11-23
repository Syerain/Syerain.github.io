// 极简 Markdown → Gutenberg 区块标记编译器（零依赖）。
// 只覆盖博客常用子集：标题 / 段落 / 列表 / 引用 / 代码块 / 分隔线 / 行内强调。
// 产物是合法的区块标记，可被 WordPress 编辑器无损打开（导出后仍可迁回 WP）。

const esc = (s) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 行内：`code` **bold** *italic* [text](url) */
export function inline(text) {
	let out = esc(text);
	const codes = [];
	out = out.replace(/`([^`]+)`/g, (_, code) => {
		codes.push(`<code>${code}</code>`);
		return `\u0000${codes.length - 1}\u0000`;
	});
	out = out
		.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" />')
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[\s(（])\*([^*]+)\*/g, '$1<em>$2</em>');
	out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
	return out;
}

const para = (t) => `<!-- wp:paragraph -->\n<p>${inline(t)}</p>\n<!-- /wp:paragraph -->`;

const heading = (level, t) =>
	`<!-- wp:heading${level === 2 ? '' : ` {"level":${level}}`} -->\n<h${level} class="wp-block-heading">${inline(t)}</h${level}>\n<!-- /wp:heading -->`;

/**
 * @param {string} src markdown 正文
 * @returns {string} 区块标记
 */
export function markdownToBlocks(src) {
	const lines = src.replace(/\r\n/g, '\n').split('\n');
	const blocks = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		// 代码块
		if (/^```/.test(line)) {
			const lang = line.slice(3).trim();
			const buf = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
			i++; // 跳过结束围栏
			const cls = lang ? ` class="wp-block-code language-${lang}"` : ' class="wp-block-code"';
			blocks.push(
				`<!-- wp:code -->\n<pre${cls}><code>${esc(buf.join('\n'))}</code></pre>\n<!-- /wp:code -->`
			);
			continue;
		}

		// 分隔线
		if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
			blocks.push(
				'<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->'
			);
			i++;
			continue;
		}

		// 标题
		const h = /^(#{1,6})\s+(.*)$/.exec(line);
		if (h) {
			blocks.push(heading(Math.min(6, h[1].length), h[2].trim()));
			i++;
			continue;
		}

		// 引用
		if (/^>\s?/.test(line)) {
			const buf = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
			blocks.push(
				`<!-- wp:quote -->\n<blockquote class="wp-block-quote">${para(
					buf.join(' ').trim()
				)}\n</blockquote>\n<!-- /wp:quote -->`
			);
			continue;
		}

		// 表格：| a | b | 换行 | --- | :---: | 换行数据行
		if (/^\s*\|.*\|\s*$/.test(line)) {
			const rows = [];
			while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++].trim());
			const isSep = (r) => /^\|[\s:|-]+\|$/.test(r);
			if (rows.length >= 2 && isSep(rows[1])) {
				const cells = (r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|');
				const aligns = cells(rows[1]).map((cRaw) => {
					const c = cRaw.trim();
					const l = c.startsWith(':');
					const r2 = c.endsWith(':');
					return l && r2 ? 'center' : r2 ? 'right' : l ? 'left' : '';
				});
				const td = (content, j) =>
					`<td${aligns[j] ? ` style="text-align:${aligns[j]}"` : ''}>${inline(content)}</td>`;
				const th = cells(rows[0])
					.map((c, j) => `<th${aligns[j] ? ` style="text-align:${aligns[j]}"` : ''}>${inline(c.trim())}</th>`)
					.join('');
				const trs = rows
					.slice(2)
					.map((r) => `<tr>${cells(r).map((c, j) => td(c.trim(), j)).join('')}</tr>`)
					.join('');
				blocks.push(
					`<!-- wp:table -->\n<figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></figure>\n<!-- /wp:table -->`
				);
				continue;
			}
			// 分隔行不合法就退回普通处理
			i -= rows.length;
		}

		// 列表
		const li = /^([-*]|\d+\.)\s+(.*)$/.exec(line);
		if (li) {
			const ordered = /\d/.test(li[1]);
			const items = [];
			while (i < lines.length) {
				const m = /^([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
				if (!m) break;
				items.push(m[2].trim());
				i++;
			}
			const tag = ordered ? 'ol' : 'ul';
			const attrs = ordered ? ' {"ordered":true}' : '';
			const lis = items
				.map((t) => `<!-- wp:list-item -->\n<li>${inline(t)}</li>\n<!-- /wp:list-item -->`)
				.join('\n');
			blocks.push(
				`<!-- wp:list${attrs} -->\n<${tag} class="wp-block-list">${lis}\n</${tag}>\n<!-- /wp:list -->`
			);
			continue;
		}

		// 段落（连续非空行合并）
		const buf = [];
		while (
			i < lines.length &&
			lines[i].trim() &&
			!/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|```|---)/.test(lines[i])
		) {
			buf.push(lines[i++]);
		}
		if (buf.length === 0) {
			buf.push(lines[i++]);
		}
		blocks.push(para(buf.join(' ').trim()));
	}

	return blocks.join('\n\n');
}

/**
 * 「积累 / 摘抄」版式：行首带首符（默认 ∅）的行开启一个条目，其后的行（无论中间有没有空行）
 * 都属于该条目；条目之间大过行，条目内各行小过行；首符悬挂在左侧，条目文字在首符右侧左对齐。
 * 首个条目之前的普通文本按常规 Markdown 渲染（可做引言）。
 *
 * @param {string} body
 * @param {{mark?: string}} opts
 */
export function accumulationToBlocks(body, { mark = '∅' } = {}) {
	const lines = body.replace(/\r\n/g, '\n').split('\n');
	const isMark = (l) => l.trimStart().startsWith(mark);
	const items = [];
	let intro = [];
	let cur = null;
	let inItems = false;

	for (const raw of lines) {
		const line = raw.trim();
		if (isMark(raw)) {
			inItems = true;
			cur = { lines: [] };
			items.push(cur);
			const rest = line.slice(mark.length).trim();
			if (rest) cur.lines.push(rest);
			continue;
		}
		if (!inItems) {
			if (line) intro.push(raw);
			continue;
		}
		if (line) cur.lines.push(line);
	}

	const out = [];
	if (intro.length) out.push(markdownToBlocks(intro.join('\n\n')));

	const lis = items
		.map((it) => {
			const ps = it.lines.map((t) => `<p>${inline(t)}</p>`).join('\n');
			return `<!-- wp:list-item -->\n<li>\n${ps}\n</li>\n<!-- /wp:list-item -->`;
		})
		.join('\n');

	out.push(
		`<!-- wp:list {"className":"accumulation"} -->\n<ul class="wp-block-list accumulation">\n${lis}\n</ul>\n<!-- /wp:list -->`
	);
	return out.join('\n\n');
}

/** 极简 front matter：--- 分隔的 key: value（容忍结尾空白与 \r\n） */
export function splitFrontMatter(raw) {
	const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
	const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
	if (!m) return { data: {}, body: text };
	const data = {};
	for (const line of m[1].split('\n')) {
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
		if (!kv) continue;
		let v = kv[2].trim();
		if (/^\[.*\]$/.test(v)) {
			v = v
				.slice(1, -1)
				.split(',')
				.map((s) => s.trim().replace(/^["']|["']$/g, ''))
				.filter(Boolean);
		} else {
			v = v.replace(/^["']|["']$/g, '');
		}
		data[kv[1]] = v;
	}
	return { data, body: m[2] };
}
