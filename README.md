# Codex 源码知识地图博客

这是组内汇报用的小型静态博客首页。当前先做知识地图主页，后续内容继续按模块拆分，不把所有东西塞进 `index.html`。

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

后续如果报告内容变多，可以继续加 `data/` 数据文件、`pages/` 页面，必要时再引入后端服务。

## 启动

在 `blog` 目录运行：

```powershell
.\start-blog.ps1
```

启动时会优先读取 `../final_docs`。如果该目录不存在，就使用 `content/final_docs/` 中保存的最近一次快照。
