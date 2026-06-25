# Codex 源码知识地图博客

这是一个用于整理 Codex 源码知识的小型静态博客。当前以知识地图主页作为入口，后续内容继续按模块拆分，不把所有东西塞进 `index.html`。

Web 版可以直接访问：[Codex-Codebase-Map](https://chenaotian.github.io/Codex-Codebase-Map/)。

## 结构约定

- `index.html`：页面壳、标题、SVG 容器和脚本入口。
- `styles.css`：纸质手绘风格、响应式布局和节点视觉层级。
- `data/map-data.js`：知识地图节点、连线、便签说明。
- `data/docs-content.js`：由同步脚本生成的文档内容清单。
- `content/final_docs/`：从 `../final_docs` 同步来的 Markdown 和图片资源快照。
- `pages/topic.html`：通用知识节点详情页入口。
- `pages/plan-tools.html`：兼容旧链接的 plan 专题入口。
- `scripts/app.js`：SVG 渲染、悬停/聚焦交互。
- `scripts/topic-page.js`：Markdown 知识详情页通用渲染逻辑。
- `scripts/sync_docs.py` / `scripts/sync-docs.ps1`：同步 `../final_docs` 并生成网页可读内容。
- `start-blog.ps1`：同步文档并启动本地网站。

后续如果知识内容变多，可以继续加 `data/` 数据文件、`pages/` 页面，必要时再引入后端服务。

## 启动

在 `blog` 目录运行：

```powershell
.\start-blog.ps1
```

启动时会优先读取 `../final_docs`。如果该目录不存在，就使用 `content/final_docs/` 中保存的最近一次快照。

## 发布到 GitHub Pages

GitHub Pages 只托管静态文件，不会运行本机的 `start-blog.ps1`，也不会读取仓库外层的 `../final_docs`。所以发布前必须先把 Markdown、图片和 drawio 快照同步进 `blog/content/` 与 `blog/data/`。

只准备静态快照，不提交也不上传：

```powershell
.\scripts\prepare-github-pages.cmd
```

第一次发布到一个空 GitHub 仓库时：

```powershell
.\scripts\publish-github-pages.cmd -RemoteUrl "https://github.com/<user>/<repo>.git" -Message "Publish blog snapshot"
```

以后已经有 `origin` remote 后，直接运行：

```powershell
.\scripts\publish-github-pages.cmd -Message "Update blog content"
```

这个脚本会：

- 同步 `../final_docs` 到 `content/final_docs/`。
- 同步 `../run_turn.drawio`、`../run_sampling_request.drawio` 到 `content/diagrams/`，并重新生成 `data/*.js`。
- 检查关键静态文件是否存在。
- 如果本机有 Node.js，会检查主要 JS 文件语法。
- `git add` 当前网站需要的静态文件，提交并 push 到 GitHub。

GitHub 仓库设置里把 Pages 配成从当前分支的根目录发布即可。当前仓库使用的是纯静态页面，入口是 `index.html`。
