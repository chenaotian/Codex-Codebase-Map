## MCP

[toc]

![ChatGPT Image 2026年6月23日 15_54_23](D:\work\codex\final_docs\MCP.assets\ChatGPT Image 2026年6月23日 15_54_23.png)

MCP可以理解为一种让 AI 连接外部工具、数据源和服务的标准协议。

### 协议规范

- 官方文档入口：[modelcontextprotocol.io](https://modelcontextprotocol.io/docs/getting-started/intro)

- 最新协议规范：[Specification latest](https://modelcontextprotocol.io/specification/latest)

- 官方 GitHub 仓库：[modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol)

### mcp server的启动

MCP server 有两种常见 transport，他们都是在创建session/zhethread 的时候尝试拉起：

- **stdio MCP**：配置的是 `command + args + env + cwd`。这种情况下 Codex 会在启动 MCP client 时自己拉起这个 server 进程**。用户要保证的是这个命令存在、依赖安装好、能正常跑。启动后codex 会通过stdin和stdout 跟这个进程交互，交互方式就是mcp协议。
- **Streamable HTTP MCP**：配置的是 `url + headers/token/oauth`。这种情况下 server 通常是远端服务或用户自己跑的 HTTP 服务，Codex 只负责在mcp client 启动的时候连接它。

不管是上面哪种mcp server，启动后会调用list_tools，获取tools 之后会认为mcp可用。将tools 暴露给模型，如果获取失败会标记mcp failed ，然后不暴露给模型。

MCP server 返回的 `instructions` 不是像 `SKILL.md` 一样单独注入上下文，而是会被挂到 MCP tool 的 namespace description 上，作为工具说明的一部分。

### mcp的使用

mcp tools 跟普通工具没区别，都是有一部分直接暴露给模型，另外一部分先隐藏，然后等模型主动调用tool_search 去搜索。**在模型眼里mcp tool和普通tool一视同仁，都是tool call。**只不过针对mcp tool的tool call 会经过handle_mcp_tool_call 来进行参数解析权限审批等操作。

mcp 的暴露只看配置是否配置这个mcp tool 默认隐藏或者mcp tool数量超过暴露数量阈值。**不会因为下面的点名情况就主动暴露或使用mcp tool，一切使用全靠模型主动发起调用，我们能做的只有用提示词引导**，不像skill，点名就会强制把skill.md塞入上下文：

- 用户点名使用某mcp
- 用户点名使用含有某mcp 的plugin
- 用户点名使用依赖某mcp 的skill(这个只会触发安装)

```
在 `build_skills_and_plugins(...)` 里：
    - 如果用户显式提到 plugin，Codex 会调用 `list_all_tools()` 拿一份 MCP inventory。
    - 这份 inventory 传给 `build_plugin_injections(...)`。
    - `build_plugin_injections(...)` 用它生成 plugin instructions，大意是：这个 plugin 有哪些 MCP server、哪些 app/connector、skill 前缀是什么。
    - 然后这些 instructions 被追加到 conversation items 里。
    
但 MCP tool 是否真的出现在本次请求的 `tools` 列表里，是另一条路径决定的：
    - `built_tools(...)` 每个 turn 会统一从 `mcp_connection_manager.list_all_tools()` 拉全部 MCP tools。
    - 然后 `build_mcp_tool_exposure(...)` 根据配置、mcp 是否 enabled、tool_search 是否启用、ui.visibility(mcp tool metadata) 是否是model、MCP 工具数量阈值等，决定 direct tools 和 deferred tools。
```

### mcp 相关工具

只要当前有 MCP server，Codex 会注册这些内置工具：

```
list_mcp_resources
list_mcp_resource_templates
read_mcp_resource
```

模型调用这些工具时，会通过 MCP manager 去读 MCP server 暴露的资源，资源就是mcp 可能会提供一些可读取的上下文资料。