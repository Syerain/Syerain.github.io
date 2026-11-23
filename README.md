# Twenty Twenty-Three → GitHub Pages

把 WordPress 官方区块主题 [Twenty Twenty-Three](https://wordpress.org/themes/twentytwentythree/) 100% 保真地发布成静态站点。

原理：[WordPress Playground](https://developer.wordpress.org/playground/)（WASM 版 WordPress，无需 PHP/MySQL）在构建时真实渲染每一页 → Node 抓取成品 HTML/CSS/图片 → 纯静态 `dist/` → GitHub Pages。

```bash
npm install
npm run build     # 约 40 s：编译内容 → 渲染 → 抓取 → dist/
npm run preview   # http://127.0.0.1:4321/tt3-pages/
```

## 写内容

- `content/posts/*.md`：front matter（`title/date/category/tags/excerpt`）+ Markdown 正文，构建时编译成 Gutenberg 区块。
  - 标签写 `tags: [注意力|attention]` 可以显式指定 ASCII slug（默认中文会变成数字 slug）。
- `content/pages/*.md`：页面自动组成导航（TT3 的导航块无 ref 时回退为页面列表），`menuOrder` 控制顺序。
- `content/site.json`：站名、描述、每页篇数、`siteUrl`、`customDomain`、风格变体（`"styleVariation": "marigold"` 等 10 个，见 `theme/twentytwentythree/styles/`）。

## 部署

1. 推到 GitHub，仓库 Settings → Pages → Source 选 **GitHub Actions**。
2. push `main`，`.github/workflows/deploy.yml` 自动构建发布。
3. 自定义域名 / `用户名.github.io` 仓库：工作流里把 `BASE_PATH` 改成 `"/"`，`site.json` 里填 `siteUrl`（可选 `customDomain` 会生成 `CNAME`）。

## 静态化的取舍

- 评论表单关闭（评论区保留展示）；要互动接 Giscus/Utterances。
- 搜索是构建期生成的客户端索引（`/search/`）。
- RSS、后台、WP 插件自然不存在。

详细分析（主题结构、三条路线对比、踩坑记录）见 [docs/分析报告与部署方案.md](docs/分析报告与部署方案.md)。

## 许可

- 主题与核心区块 CSS：GPL-2.0-or-later（`theme/` 下保留原版权与 OFL 字体许可）。
- 示例文字为原创占位内容。
