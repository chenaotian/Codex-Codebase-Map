## turn & run_turn

[toc]

### [0] 基本概念

#### turn

在codex 中，一个单独的会话称作一个thread，这个会话有个全局的管理数据结构，叫做session，里面存放这个会话的公共信息，然后在会话中，每发起一次任务回合，叫做一个turn，注意这里turn只的是一个完整任务回合而不是一次模型交互，也就是说一个turn中大部分情况下有多次模型交互。

#### run_turn

先不考虑thread，先从一次完整的任务回合来看codex 是如何完成用户指令的，run_turn就是一次用户输入的完整处理流程，这其中可能有多次模型交互和工具交互等。

#### task类型

task类型是turn 的分类，它们由 `SessionTask::kind()` 暴露给 session 生命周期，用来决定这个 turn 能不能被 steer、如何上报 telemetry/UI、以及 active task 如何被取消和完成，一共有三种：

```
pub(crate) enum TaskKind {
    Regular,
    Review,  //代码审查 /review
    Compact, //特指用户主动触发的/compact
}
```

##### Regular

`Regular` 是普通用户 turn。如果当前没有 active turn，就创建regularturn，它会发送 `TurnStarted`，然后进入 `run_turn()` 主循环。

##### Review

`Review` 是 `/review` 的代码审查 task。由Op::Review  触发，其实就是/review。值得一提的是，它会启动一个 review 子agent，设置 review 专用 base instructions，禁用/限制部分能力，并把输出解析成 `ReviewOutputEvent`。

```
用户 /review
  -> core 收到 Op::Review
  -> 创建 ReviewTask
  -> ReviewTask 启动 reviewer 子会话
  -> reviewer 用 REVIEW_PROMPT + review 目标去审代码
  -> reviewer 输出 JSON/ReviewOutputEvent
  -> 父线程收到 ExitedReviewMode
  -> review 结果被写回会话历史
```

##### Compact

`Compact` 特指用户主动触发的 `/compact`，它会根据 provider/feature 选择 remote v2、remote、local 三条路径中的一条来生成summary，然后 `replace_compacted_history()` 替换 session history。关于上下文压缩详见后文分析。

### [1] 上下文预压缩

run_pre_sampling_compact，在真正构造 prompt / 调模型前，先尝试做必要的压缩。这里包括两个条件：

- 上一轮模型上下文和当前模型窗口不匹配时的压缩。
- 当前 token 已经超出 auto compact 阈值时的压缩。

触发其中之一就会压缩上下文。

[详情跳转压缩上下文]

### [2] 前置准备

调用record_context_updates_and_set_reference_context_item更新基线等变化状态/提示词。

### [3] 插件检测

调用build_skills_and_plugins 根据本次初始 input 检测显式提到的 skill/plugin/app。

[详情跳转MCP & skill]

### [4]  hook点SessionStart

run_pending_session_start_hooks，一个hook点，可以决定是否拦截本次输入。

如果拦截，则直接结束，未拦截则继续下一步。

### [5] 记录当前模型

调用set_previous_turn_settings 记录当前使用的模型，如果下一个turn切换模型则会用这个记录的模型做上下文压缩。

### [6] 注入skill/mcp

把之前build_skill找到的skill或mcp之类的提示词写进当前 session 的 conversation history

### [7] 创建文件变更追踪

设置diff展示的根目录display_root，并创建文件变更追踪器，后续codex 写代码或者打补丁用这个来给前端显示更新了哪些文件。

### [8] input为空？

判断input是否为空：

- 如果input为空，则设置can_drain_pending_input =true，允许pending_input注入。
- 如果input不为空，则说明用户输入了内容，则暂时不允许pending_input注入，设置can_drain_pending_input = false。

### [9] 允许pending_input？

判断刚才设置的can_drain_pending_input，查看是否允许pending_input。

### [10] 注入pending_input

获取pending_input，注入到conversation history里

### [11] 构造提示词

构造发送给模型的提示词，从 session 里复制一份当前 conversation history，此时用户发送的话已经添加到history里了，所以自然是有用户最新发送的内容或pending input的。这里会根据模型的支持把历史消息中的一些多模态数据过滤或整理。

### [12] 发送请求

[跳转到run_sampling_request]

`run_sampling_request` 是 Codex 一次模型 sampling 的内层执行器。它负责为当前 turn 构建工具表、构建 prompt、调用模型流式接口、处理模型输出事件、排队并执行工具调用、把模型输出和工具结果写回会话历史、发送 UI/协议事件、处理 token/ratelimit/diff 信息，并决定外层 `run_turn` 是否需要再发起下一次模型请求。

#### 实现步骤

##### built_tools

**built_tools为当前这一轮模型请求临时组装一张工具路由表ToolRouter**，包含两类东西：

```
ToolRouter
  ├─ registry              本地工具实现表，用来执行工具
  └─ model_visible_specs   发给模型看的工具说明，用来让模型知道能调用什么
```

可以理解为registry 是当前可用工具的全集，model_visible_specs是决定直接发给模型的部分工具，其他没法给模型的可以通过tool_search获取。

发给模型的每个工具大概包括这些信息：

```json
{
  "name": "shell_command",
  "description": "Runs a Powershell command...",
  "parameters": {
    "type": "object",
    "properties": {
      "command": { "type": "string" },
      "workdir": { "type": "string" },
      "timeout_ms": { "type": "number" }
    },
    "required": ["command"]
  }
}
```

built_tools具体工作流程：

1. 从 MCP connection manager 读取当前所有 MCP tools。
2. 根据当前配置加载插件，拿到插件贡献的 apps / extension tools。
3. 判断 MCP tools 是直接暴露给模型，还是 deferred 到 `tool_search` 后再暴露。
4. 调 `ToolRouter::from_turn_context(...)` 构建最终 `ToolRouter`。

##### get_base_instructions

从 `state.session_configuration.base_instructions` 里 clone 一份字符串包装成 `BaseInstructions { text }` 返回，它最终会进入 `Prompt`。

session 中的base_instructions 是session 初始化的时候决定的，thread 创建的时候可以传入自定义的base_instructions。

##### retry loop

第一次请求使用调用方传进来的 `input`。如果发生可重试 stream 错误，下一轮 retry 不再复用最初的 `input`，而是重新从 session history 克隆 prompt input。

这个设计很重要：

- 如果 stream 中途断开，history 可能已经包含部分模型输出或工具调用；
- retry 时重新从 history 构造 prompt，能让重试基于最新事实继续，而不是盲目重发旧 prompt。

##### build_prompt

组装本次请求的prompt，大概有这些，最后组装成一个json：

```rust
Prompt {
    input,
    tools: router.model_visible_specs(),
    parallel_tool_calls: turn_context.model_info.supports_parallel_tool_calls,
    base_instructions,
    personality: turn_context.personality,
    output_schema: turn_context.final_output_json_schema.clone(),
    output_schema_strict: !guardian::is_guardian_reviewer_source(&turn_context.session_source),
}
```

##### try_run_sampling_request

`try_run_sampling_request` 才是真正处理 Responses stream 的地方。

工作流程，核心是stream+loop，`stream` 是异步事件源，loop 是实时消费者。：

- 发起streaming 请求，内部会优先走 Responses WebSocket，必要时 fallback 到 HTTP。该请求是异步的，一直持续接受模型输出，然后try_run_sampling_request逻辑会继续

- 循环：

  - 从stream 中获取一个事件

  - 记录TTFT(time to first token，从turn开始到第一个有效模型输出事件出现时间)。

  - match event 

    - Created事件，不需要处理

    - OutputItemDone事件，最重要的事件，工具调用、assistant message、reasoning、web search、image generation 等最终都在这里。

      - 把之前没收尾的Delta事件收尾，包括事件管理和前端显示等。

      - 如果当前是plan模式，并且当前完成的 item 是 assistant message，就用 Plan Mode 规则处理它。因为返回的assistant message 中可能含有计划块，处理完直接continue：

        ```
        <proposed_plan>
        1. 先读源码
        2. 再修改文档
        3. 最后校对
        </proposed_plan>
        ```

      - handle_output_item_done，处理一个完整 `ResponseItem`的统一入口：

        - 如果是工具调用，则初始化工具调用相关，设置needs_follow_up=true
        - 不是工具调用则提取last_agent_message
        - 开始异步调用工具

    - OutputItemAdded 事件，在模型输出一个 item 刚开始时做准备，一些前端操作和状态保存等操作。

    - ServerModel事件，服务端会告诉客户端本次请求使用模型，可能因为各种原因跟请求时候配置的不同。

    - Completed事件，完结消息，整个请求完成，

      - 如果服务端提出end_turn=false，则设置needs_follow_up=True
      - 准备返回信息，needs_follow_up & last_agent_message

    - OutputTextDelta/ToolCallInputDelta：处理文本增量，解析和发送前端/工具增量，保存和发送前端等/思考增量，发送前端。

    - ReasoningSummaryDelta/ReasoningSummaryPartAdded/ReasoningContentDelta：reasoning 相关，分别是reasoning增量/reasoning 新开一小段/raw reasoning信息。这里返回的都是给前端展示的明文内容，核心完整思考内容在 completed reasoning item里直接返回加密的值保存在rollout中。

    - ModelVerifications/ServerReasoningIncluded/RateLimits/ModelsEtag：账号认证状态/reasoning是否计费/限额处理/模型列表变化

- 等待工具调用结果，并处理失败，把成功结果写进history

- 发送diff结果

- 返回

##### 特殊错误处理

`try_run_sampling_request` 返回后，`run_sampling_request` 特判：

- `ContextWindowExceeded`: token usage 状态标记为已满，然后向上返回。

- `UsageLimitReached(e)`: 如果错误里带有 rate limits，就更新 session rate limits，再向上返回。

- 其他错误：如果不可重试，直接返回；如果可重试，交给 `handle_retryable_response_stream_error`。

  - 如果已达到 retry 上限，并且还能切换 fallback transport，就从 WebSocket fallback 到 HTTP；

  - 如果还没达到 retry 上限，就递增 retry count，根据错误建议 delay 或指数 backoff sleep；

  - retry 用完仍失败则返回原错误。

#### 发送和返回内容

##### 发送内容

组装好后的prompt会转换成json发过去，内容形如：

```json
{
  "model": "gpt-5.3-codex",
  "instructions": "...base instructions...",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "帮我看看当前目录有哪些文件"
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "我先列一下目录。"
        }
      ]
    },
    {
      "type": "function_call",
      "name": "shell_command",
      "call_id": "call_001",
      "arguments": "{\"command\":\"Get-ChildItem\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_001",
      "output": "README.md\nsrc/\nCargo.toml"
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "目录里有 README.md、src 和 Cargo.toml。"
        }
      ]
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "那 src 下面有什么？"
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "function",
      "name": "shell_command",
      "description": "Runs a Powershell command and returns its output.",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string"
          },
          "workdir": {
            "type": "string"
          }
        },
        "required": ["command"]
      }
    }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  },
  "stream": true,
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

##### 返回内容

stream不是直接返回完整的结果，而是返回一个事件列表，模型是流式输出，所以不是一次性返回完整回答，而是一段一段往外吐；Codex 每次从 stream 里取到一个“事件”。，举例子：

```
1. Created
   服务端创建了 response

2. OutputItemAdded(Message assistant)
   一个 assistant message 开始了

3. OutputTextDelta("run_sampling_request")
   返回一小段文本

4. OutputTextDelta(" 是 Codex")
   又返回一小段文本

5. OutputTextDelta(" 的一次模型请求执行器")
   又返回一小段文本

6. OutputItemDone(Message {
     role: "assistant",
     content: "run_sampling_request 是 Codex 的一次模型请求执行器"
   })
   这个 assistant message 完整结束

7. Completed {
     response_id,
     token_usage,
     end_turn: true
   }
   整个 response 结束
如果是调用工具：
1. Created

2. OutputItemAdded(FunctionCall shell_command)
   工具调用 item 开始

3. ToolCallInputDelta("{\"command\":\"rg ")
   工具参数的一部分

4. ToolCallInputDelta("-n run_sampling_request")
   工具参数又一部分

5. OutputItemDone(FunctionCall {
     name: "shell_command",
     arguments: "{\"command\":\"rg -n run_sampling_request\"}",
     call_id: "call_123"
   })
   工具调用 item 完成

6. Completed {
     end_turn: false 或 true
   }
如果是web search:
1. Created

2. OutputItemAdded(WebSearchCall)
   服务端 web_search 开始/记录

3. OutputItemDone(WebSearchCall {
     action: search,
     query: "..."
   })

4. OutputItemAdded(Message assistant)

5. OutputTextDelta("根据搜索结果...")

6. OutputItemDone(Message {...})

7. Completed
```

#### 结果处理

如果请求失败：

- TurnAborted：安静结束
- InvalidImageRequest：尝试净化历史图片，否则报 BadRequest
- 其他错误：发 ErrorEvent，结束

如果请求成功，则获取返回值：

- needs_follow_up 代表是否还需要继续调用模型
- last_agent_message 代表模型的输出

### [13] 允许pending_input

can_drain_pending_input 设置为true(下一次就可以取pending input了)

### [14] 查看pending_input

查看刚才请求期间用户是否发送了pending input，避免请求之前没有pending_input，请求结束之后模型还返回needs_follow_up=true，然后用户又输入了新的pending_input，结果没处理就返回了。

### [15] 继续？

是否继续的条件取决于`模型返回的needs_follow_up`或`用户是否发送了pending_input`。

继续：查询当前花费token与当前模型的token 上限，记录日志。

结束：

### [16] 压缩上下文？

auto_compact_token_status 自动上下文压缩判断，刚才已经统计了当前token量和当前模型的token 限制，判断是否达到阈值需要压缩上下文。

- 需要：如果还需要继续请求模型并且token使用到达上限，则调用run_auto_compact 压缩上下文
  - 失败 失败就失败了
  - 成功：
    - can_drain_pending_input = !model_needs_follow_up; 这里很精妙，如果模型上一轮决定还需要继续调用一轮，则把插入用户pending input设置为flase，下一轮先不插入用户pending input。
    - 继续下一轮循环

[详情跳转压缩上下文]

### [17] 准备返回内容

如果不需要follow-up，准备last_agent_message 为模型最后返回的文本

### [18] hook点Stop

Stop hook点，调用run_turn_stop_hooks，用户可以在hook逻辑中决定是否结束：

- 继续turn，hook 要求 block，hook 认为现在还不能结束，需要让模型再继续一轮。
  - build_hook_prompt_message 把 hook prompt 写入历史。 下一轮模型请求会看到它，从而按 hook 要求继续生成/修正。
  - hook 要求 block，但没有给 continuation prompt。忽略然后继续
- 结束turn，如果 hook 明确要求 stop，就结束 loop。后面函数会返回当前的 last_agent_message。

### [19] 结束

返回最终结果，如果成功会有模型的last_agent_message，会显示在前端。