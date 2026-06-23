## MCP & skill

![ChatGPT Image 2026年6月23日 15_56_57](D:\work\codex\final_docs\MCP & skill.assets\ChatGPT Image 2026年6月23日 15_56_57.png)

- **Skill**：给模型看的“操作手册/工作流说明”。核心形态是本地 `SKILL.md`，被显式触发后把说明内容注入上下文。
- **Plugin**：一个“能力打包和分发单元”。它可以包含 skills、MCP server 配置、App connector ID、hooks 等。
- **MCP**：运行期工具协议层。Codex 通过 MCP server 获得工具、资源、资源模板，并把模型的工具调用路由到对应 server。
- **Connector**：ChatGPT Apps / Codex Apps 里的“外部应用连接器身份”。它本身不是一个本地工具实现，最终通常通过内置 `codex_apps` MCP server 暴露成 MCP tools。

后续重点解释MCP和skill
