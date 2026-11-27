// 纯前端搜索：数据来自 assets/js/search-index.js（构建时生成）。
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
