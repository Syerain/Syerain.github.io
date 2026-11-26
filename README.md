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
  - `category` 填 `content/site.json` 里分类的 **slug**（如 `tech`、`gushiwen`）。
  - 标签写 `tags: [诗词|shici]` 可显式指定 ASCII slug（默认中文名会变成数字 slug）。
  - 封面默认自动生成抽象渐变图；想用自己的图，把文件放进 `content/covers/`，front matter 写 `cover: 文件名.png`（或 `.jpg`）。
- `content/pages/*.md`：页面自动组成导航（TT3 的导航块无 ref 时回退为页面列表），`menuOrder` 控制顺序。
- `content/site.json`：站名、描述、每页篇数、`siteUrl`、`customDomain`、作者、分类表、风格变体（`"styleVariation": "marigold"` 等 10 个，见 `theme/twentytwentythree/styles/`）。

Markdown 子集支持：标题、段落、列表、引用、代码块、表格、分隔线、行内 `code`/**加粗**/*斜体*/[链接]。

### 积累 / 摘抄版式

摘抄合集类文章用专门版式：front matter 加 `layout: accumulation`，正文行首写 `∅` 开一个条目：

```markdown
---
title: 今日文字
layout: accumulation
---

∅ 当计划外的闲逛变成最难忘的一晚。

∅ 你所浪费的今天，是昨日死去之人苦苦奢望的今天。

你所厌恶的现在，是未来的你再也回不去的曾经。
```

- 行首 `∅` = 新条目；其后所有行（中间有没有空行都算）属于这一条 → 条目内**小过行**
- 下一个 `∅` 之前 = **大过行**
- 首符悬挂在左侧，条目各行在首符右侧左对齐
- 条目内只支持行内格式（`**粗体**`、`` `代码` ``、`[链接]`）；首条之前的段落按完整 Markdown 渲染，可做引言
- 换首符：front matter `mark: "◇"`。注意 `∅` 是 U+2205，别打成 `Ø`

### 专栏版式

日记、随笔类文章用 `layout: column`，换行语义与标准 Markdown 不同——**单换行就是换行**：

```markdown
---
title: 十一月二十二日
layout: column
---

早上醒来的时候，光已经爬到床沿。
楼下有人在扫雪，一下，一下。      ← 单换行 = 段内换行，紧凑
我躺着没动，听了一会儿。

窗台上那盆薄荷还活着。            ← 空行 = 分段，间距大
```

标题、引用、列表等块级语法照常可用；引用块内的多行同样按段内换行处理。段内行距与段间距可在 `content/site.css` 的 `.column-layout` 处调。

### 自定义样式

`content/site.css` 在构建时追加到主题 CSS 之后，所有视觉微调都在这里改（积累版式的间距、首符颜色也在这个文件里）。

## 在 GitHub 网页上直接编辑（不用本地环境）

**可以，日常发文/改文案完全不用 clone。** 推到 `source` 分支的任何提交都会触发 Actions 重新构建并发布，约 3–5 分钟后线上生效：

| 想改什么 | 在网页上改哪里 |
| --- | --- |
| 发一篇新文章 | `content/posts/` → Add file → 命名 `2026-12-01-技术：标题.md`，写 front matter + 正文 |
| 改文章内容/文案 | 直接编辑对应的 `content/posts/*.md`、`content/pages/*.md` |
| 站名、描述、每页篇数、作者、分类 | `content/site.json` |
| 文章封面 | 编辑文章时把图片拖进 `content/covers/`（网页上传），front matter 引用 `cover: 文件名.png` |
| 界面固定文案（404 提示、分页"下一页"等） | `scripts/export.mjs` 里的汉化字符串表 |
| 主题模板结构（页眉/页脚布局） | `theme/twentytwentythree/parts/*.html`、`templates/*.html`（本质也是文本文件） |

两点注意：

1. **改坏了不会弄挂线上站点**——构建失败时 Actions 不会推 `main`，线上保持上一次成功版本，修好再推即可。
2. 正文里引用图片请用**绝对 URL**（GitHub 网页上传后 `?raw=true` 链接或任意图床）；相对路径不会被构建器解析。

## 部署（本仓库当前形态：`Syerain.github.io`）

- `source` 分支：**全部源码**（你日常只推这个分支）
- `main` 分支：**纯构建产物**（由工作流自动覆盖，别手改）

推送 `source` 后 `.github/workflows/deploy.yml` 自动构建并把 `dist/` 强推到 `main`；Pages 用「从分支部署 main/(root)」即可直接生效，若配置为「GitHub Actions」模式也能走备用通道。首次部署后约 1 分钟生效。

换到其它仓库：普通仓库会自动发布到 `/仓库名/` 子路径（工作流里自动判断），无需改任何配置。

## 静态化的取舍

- 评论区整体移除（TT3 的评论模板部件不再导出）；要互动可接 Giscus/Utterances，或用仓库 Discussions。
- 搜索是构建期生成的客户端索引（`/search/`）。
- RSS、后台、WP 插件自然不存在。

详细分析（主题结构、三条路线对比、踩坑记录）见 [docs/分析报告与部署方案.md](docs/分析报告与部署方案.md)。

## 许可

- 主题与核心区块 CSS：GPL-2.0-or-later（`theme/` 下保留原版权与 OFL 字体许可）。
- 示例文字为原创占位内容。
