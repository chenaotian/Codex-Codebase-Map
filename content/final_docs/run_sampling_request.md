## run_sampling_request

[toc]

### [0] run_sampling_request

`run_sampling_request` 是 Codex 一次模型 sampling 的内层执行器。它负责为当前 turn 构建工具表、构建 prompt、调用模型流式接口、处理模型输出事件、排队并执行工具调用、把模型输出和工具结果写回会话历史、发送 UI/协议事件、处理 token/ratelimit/diff 信息，并决定外层 `run_turn` 是否需要再发起下一次模型请求。

### [1] built_tools

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

### [2] get_base_instructions

从 `state.session_configuration.base_instructions` 里 clone 一份字符串包装成 `BaseInstructions { text }` 返回，它最终会进入 `Prompt`。

session 中的base_instructions 是session 初始化的时候决定的，thread 创建的时候可以传入自定义的base_instructions。

### [3] loop start

第一次请求使用调用方传进来的 `input`。如果发生可重试 stream 错误，下一轮 retry 不再复用最初的 `input`，而是重新从 session history 克隆 prompt input。大概就是跟模型交互是流式的嘛，给模型发完消息，模型会一个事件一个事件往出蹦，中间可能会失败，所以需要重试，那么重试就要用之前失败的时候的最新history来重试。

这个设计很重要，可以保证codex 一个任务断开，你直接跟他说继续工作就能接上：

- 如果 stream 中途断开，history 可能已经包含部分模型输出或工具调用；
- **retry 时重新从 history 构造 prompt，能让重试基于最新事实继续，而不是盲目重发旧 prompt。**

### [4] build_prompt

组装本次请求的prompt，大概有这些，最后组装成一个json，见下一节。

### [5] try_run_sampling_request

`try_run_sampling_request` 才是真正处理 Responses stream 的地方。

工作流程，核心是stream+loop，`stream` 是异步事件源，loop 是实时消费者。

### [6] 发起请求

发起streaming 请求，内部会优先走 Responses WebSocket，必要时 fallback 到 HTTP。该请求是异步的，一直持续接受模型输出，然后try_run_sampling_request逻辑会继续

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
  "parallel_tool_calls": true, //允许模型一次返回多个toolcall
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

### [7] 循环match event

![ChatGPT Image 2026年6月25日 11_39_07](D:\work\codex\final_docs\run_sampling_request.assets\ChatGPT Image 2026年6月25日 11_39_07.png)

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

### [8] 结束阶段

等待工具调用结果，并处理失败，把成功结果写进history

发送diff结果

### [9] try_run_sampling_request结束

返回needs_follow_up & last_agent_message

### [10] 结果处理

#### 特殊错误处理

`try_run_sampling_request` 返回后，`run_sampling_request` 特判：

- `ContextWindowExceeded`: token usage 状态标记为已满，然后向上返回。

- `UsageLimitReached(e)`: 如果错误里带有 rate limits，就更新 session rate limits，再向上返回。

- 其他错误：如果不可重试，直接返回；如果可重试，交给 `handle_retryable_response_stream_error`。

  - 如果已达到 retry 上限，并且还能切换 fallback transport，就从 WebSocket fallback 到 HTTP；

  - 如果还没达到 retry 上限，就递增 retry count，根据错误建议 delay 或指数 backoff sleep；

  - retry 用完仍失败则返回原错误。

- 如果请求成功，则获取返回值：

  - needs_follow_up 代表是否还需要继续调用模型

  - last_agent_message 代表模型的输出

### [19] 结束

返回结果：

- needs_follow_up 代表是否还需要继续调用模型

- last_agent_message 代表模型的输出