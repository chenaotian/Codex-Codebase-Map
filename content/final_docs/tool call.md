## tool call

![ChatGPT Image 2026年6月23日 15_01_09](D:\work\codex\final_docs\tool call.assets\ChatGPT Image 2026年6月23日 15_01_09.png)

### 工具概览

tool call是提供给大模型可以使用的工具，默认情况下，codex里面会加入这些工具：

- **Shell / 文件环境工具**
  - exec_command：更偏交互式/PTY 的命令执行器。可以后台启动一个持续运行的 session，比如 dev server、交互命令、长任务。
  - write_stdin：给已有的 exec_command session 写入输入，比如向交互式进程发送回车、命令、确认字符。
  - shell_command：执行本地 shell/PowerShell 命令，返回输出。
  - exec：Code Mode 里的执行器，运行代码模式 runtime 中的 JS/工具脚本。
    - 并且 exec 里面还会把其他工具包装成 JS 里的 nested tools，比如 await tools.exec_command(...)。
  - wait：Code Mode 里等待或恢复某个正在运行的执行单元。
  - request_permissions：请求额外权限，例如执行需要越过沙箱限制的命令。
- **文件与视觉类**
  - apply_patch：用补丁格式编辑文件。源码修改时通常走这个，而不是直接重写整个文件。
  - view_image：读取本地图片文件并让模型进行视觉检查，比如看截图、UI 渲染、图像内容。
- **计划与用户交互类**
  - update_plan：更新任务计划/checklist，让用户看到当前步骤状态。
  - request_user_input：向用户提出结构化问题，一般用于 Plan mode 或需要明确选择时。
- **Goal 类**
  - get_goal：获取当前线程的目标、状态、预算等。
  - create_goal：创建一个明确的长期目标。源码里这个不是普通任务自动创建的，通常需要显式请求。
  - update_goal：把目标标记为完成或阻塞。
- **MCP 资源工具**
  - list_mcp_resources：列出 MCP server 暴露的资源，比如文件、schema、上下文资料。
  - list_mcp_resource_templates：列出 MCP server 暴露的参数化资源模板。
  - read_mcp_resource：读取某个具体 MCP 资源内容。
- **插件 / App 发现和安装工具**
  - list_available_plugins_to_install：列出可安装的插件或连接器候选项。
  - request_plugin_install：请求安装某个插件或连接器。
- **多 agent / 协作工具**
  - agent job: 
    - spawn_agents_on_csv：按 CSV 中的行批量派生子 agent 做任务。
    - report_agent_job_result：子 agent 用来回报批处理任务结果。
  - v1 namespace: 
    - multi_agent_v1.spawn_agent：创建一个子 agent。
    - multi_agent_v1.send_input：向已有子 agent 发送输入。
    - multi_agent_v1.resume_agent：恢复一个已关闭或暂停的 agent。
    - multi_agent_v1.wait_agent：等待一个或多个 agent 完成、更新或超时。
    - multi_agent_v1.close_agent：关闭 agent 及其子 agent。
  - v2: 
    - spawn_agent：Multi-Agent v2 的创建 agent 工具。
    - send_message：v2 中向 agent 发消息，但不一定触发它立刻执行。
    - assign_task：v2 中给 agent 分配任务，并触发目标 agent 执行。
    - wait_agent：v2 中等待 agent 状态变化、消息或任务完成。
    - close_agent：v2 中关闭 agent。
    - list_agents：v2 中列出当前 live agents。
- **通用运行时 handler**
  - McpHandler：不是单个固定工具名，而是 MCP 工具的通用 handler。只要 MCP server 暴露了工具，Codex 会用它来转发调用。
  - DynamicToolHandler：处理宿主动态注入的工具。工具名和 schema 不是源码固定写死的，而是运行时传进来的。
  - ExtensionToolAdapter：适配插件/扩展提供的工具，把插件工具接进 Codex core 的工具运行体系。
- **Hosted provider 工具**
  - web_search：provider 侧的网页搜索工具。意思是可以将web 搜索放到模型提供方侧进行。比本地curl 搜索要好一些。前提是provider 支持。
  - image_generation：provider 侧的图片生成工具。也不是本地固定 handler 那种，而是 hosted tool spec。
- **工具发现**
  - tool_search：搜索“延迟暴露”的工具元数据，并把匹配工具暴露给下一轮模型。它本身像一个工具目录检索器。
    - 只有当模型支持 search tool、支持 namespace tools，并且存在 deferred tools 时才加。
- **测试类**
  - test_sync_tool：测试/同步用工具，主要用于源码里的测试路径，不是正常用户工作流里的常用能力。

### 工具的状态

可以分成三种状态：

1. **已注册且直接暴露**
   模型在请求里直接看到这个工具，可以直接调用。比如常见的 shell_command、apply_patch、update_plan 等。
2. **已注册但 Deferred**
   模型一开始看不到具体工具，只看到 tool_search。这些工具已经在 Codex 侧注册了，并且提供了 search_info，所以 tool_search 能搜到并在下一步暴露出来。v1 多 agent 在某些 provider/namespace 条件下就是这种。
3. **没有注册**
   只是在源码里存在，当前配置/feature/provider/mode 不满足。模型看不到，tool_search 也搜不到，调用了也没有 handler 能接。

所以 tool_search 不是搜索“Codex 源码里所有工具”，而是搜索 **当前 turn 已规划、可延迟暴露的工具索引**。

每次模型 sampling request 都会重新 build/register 一次工具 router:

- 外层 turn 循环会调用 run_sampling_request(...)。
- run_sampling_request 一开始就调用 built_tools(sess, turn_context, ...)。
- built_tools 最后构造 ToolRouter::from_turn_context(...)。
- ToolRouter 里包含本次请求的 registry 和 model_visible_specs。