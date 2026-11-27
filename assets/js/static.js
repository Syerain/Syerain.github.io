// 从 WordPress 前端脚本改为纯静态实现：只保留移动端菜单展开/收起。
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
