## app-server

[toc]

![ChatGPT Image 2026年6月23日 19_32_32](D:\work\codex\final_docs\app-server.assets\ChatGPT Image 2026年6月23日 19_32_32.png)

`app-server` 是 Codex App 使用的本地 JSON-RPC 服务层，负责把客户端请求转换成 Codex core 的会话、线程、turn、工具调用和事件流。它位于 UI/客户端与 core runtime 之间，`app-server` 能支持比单纯 CLI/TUI 更细粒度的控制，例如自定义历史、外部上下文注入、多客户端订阅、分页读取历史、回滚末尾 turn、以及和自定义 agent 控制层集成。

具体怎么使用app-server 编程来实现自己的agent 不讨论，没意义，因为都是用ai开发。这里列举一些重要功能的参数，根据参数可以看出我们可以自定义到什么程度。

### thread 方法

![ChatGPT Image 2026年6月23日 19_32_47](D:\work\codex\final_docs\app-server.assets\ChatGPT Image 2026年6月23日 19_32_47.png)

#### thread/start

对应的场景就是启动一个全新的会话。

部分传参：

- `model`/`modelProvider`：指定线程使用的模型，和模型provider。
- `cwd`：thread的工作目录，一般就用来计算相对路径，不是workspace。
- `approvalPolicy`：控制什么时候需要向用户请求批准，比如永不、按需、失败时等。会转换成 core 层的 approval policy，参考审批章节。
- `approvalsReviewer`：审批请求给谁看，用户或auto-review subagent(替我审批)。
- `sandbox`：旧式/兼容式沙箱参数，比如 read-only、workspace-write、danger-full-access。会转换成 core 的 `sandbox_mode`。
  - read-only
  - workspace-write
  - danger-full-access
- `baseInstructions`/`developerInstructions`/`personality`：覆盖基础系统指令/ developer 指令/线程人格/风格指令。
- `ephemeral`：是否创建临时线程。临时线程通常不暴露持久 rollout path。
- `sessionStartSource`：表示这次启动的历史初始化方式，目前有：
  - `Startup`：普通新线程，`InitialHistory::New`，就是纯新会话
  - `Clear`：清空后的新线程，`InitialHistory::Cleared`，清空后的会话，就是调用/clear。
- `threadSource`：线程来源分类，偏 analytics/元数据用途。协议里有：
  - `User`：用户新建的thread。
  - `Subagent`：其他agent 创建的子agent thread。
  - `MemoryConsolidation`：系统发起的用于提取记忆的agent。

下面的参数是实验性参数，需要开启experimentalApi 才可以使用：

- `permissions`：新的命名权限 profile id。比如某个内置 profile 或配置里定义的 profile。注意它不能和 `sandbox` 同时传
  
  - read-only
  - workspace
  - danger-full-access
  - my-custom-profile：自定义权限，可以自己配置规则， 允许读写哪些目录，是否允许网络等。
  
- `environments`：线程级 sticky environments。这里需要传入注册好的合法environment，注册需要调用app-server的独立接口`environment/add` 。后续每个turn 都可以选择一个environment 作为自己的环境（当然也可以选择这里没有的，意义不是很大）。每个元素有 `environment_id` 和 `cwd`。如：

  ```
  [
    { "environmentId": "local", "cwd": "D:\\work\\codex" },
    { "environmentId": "remote", "cwd": "/workspace/codex" }
  ]
  ```

- `dynamicTools`：**启动 thread 时动态注册工具。**每个工具有 `namespace`、`name`、`description`、`input_schema`、`defer_loading`。可以理解为工具使用方法声明，app-server会将其暴露给大模型，大模型要使用的时候app-server会管客户端要。

返回:

```json
{
  "id": 10,
  "result": {
    "thread": {
      "id": "thr_123",
      "sessionId": "thr_123",
      "forkedFromId": null,
      "preview": "",
      "ephemeral": false,
      "modelProvider": "openai",
      "createdAt": 1730910000,
      "updatedAt": 1730910000,
      "status": { "type": "idle" },
      "path": "/path/to/rollout.jsonl",
      "cwd": "/Users/me/project",
      "cliVersion": "x.y.z",
      "source": "vscode",
      "threadSource": "user",
      "agentNickname": null,
      "agentRole": null,
      "gitInfo": null,
      "name": null,
      "turns": []
    },
    "model": "gpt-5.1-codex",
    "modelProvider": "openai",
    "serviceTier": null,
    "cwd": "/Users/me/project",
    "runtimeWorkspaceRoots": ["/Users/me/project"],
    "instructionSources": ["/Users/me/project/AGENTS.md"],
    "approvalPolicy": "never",
    "approvalsReviewer": "user",
    "sandbox": { "...": "SandboxPolicy shape" },
    "activePermissionProfile": null,
    "reasoningEffort": null
  }
}
```

- agentRole：子 agent 的角色名，比如 `researcher`、`reviewer`、`explorer`，也可能是用户配置的自定义 role。只有子agent spawn 流程才有
- instructionSources：代表这个thread 自动识别生效的effective prompt。可能会有全局的AGENTS.md和递归搜索cwd 中的AGENTS.md

#### thread/resume

对应的场景就是选择一个已经存在的会话，这个会话可能正在内存中运行，只是重新连接他，也有可能这个会话已经关闭了，那么需要重新拉起。

部分特殊传参：

- `threadId`：恢复指定threadid 的会话。
- `path`：**从指定rollout 文件恢复会话。**
- `history`：**可以自己传一段json 格式的history 来恢复会话。**
- `baseInstructions`/`developerInstructions`/`personality`：可以覆盖这三者，下一次 `turn/start` 时，app-server/core 会用“旧 conversation history + 新的 instruction/personality 配置”组装后续模型请求。因此它们影响的是之后的模型行为，而不是过去的历史。
- `excludeTurns`：返回包中不返回thread 的完整历史，减少返回包大小。
- `initialTurnsPage`：返回大概一页内容的历史，不返回完整历史，这样可以让客户端渲染一页内容出来。

恢复规则：

- 如果传了 `history`，app-server 用这段 history 启动，不从磁盘读。这个路径在实现里进入 `InitialHistory::Forked`，更像“用外部 history 构造一个 live thread”，普通客户端不要把它当成稳定的“按 id 恢复并保留同一个 threadId”能力。
- 如果没传 `history`，但传了非空 `path`，app-server 从这个 rollout path 恢复，`threadId` 会被忽略。
- 如果都没传，就按 `threadId` 读取存储中的 thread。
- 如果 `threadId` 指向一个正在内存中运行的 thread，app-server 会 rejoin 这个 running thread；此时 `path` 只作为一致性检查，必须匹配 active rollout path。

#### thread/fork

对应的场景是根据一个已经存在的会话，选择其中一个位置fork，从这个位置之前拷贝一份历史到一个全新的会话。

部分参数：

- `baseInstructions`/`developerInstructions`：可以覆盖这两者，注意fork没有personality参数。

#### thread/goal/set

设置goal，参数如：

```json
{
  "method": "thread/goal/set",
  "id": 27,
  "params": {
    "threadId": "thr_123",
    "objective": "持续优化 benchmark，直到 p95 latency 低于 120ms",
    "tokenBudget": 200000
  }
}
```

#### thread/inject_items

不启动 turn、不让模型立刻运行，而是把你提供的 raw Responses API items 直接追加到已加载 thread 的“模型可见历史”里，让后续 turn 的模型请求能看到这些内容。

参数如：

```json
{
  "threadId": "thr_123",
  "items": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "Injected assistant context" }
      ]
    }
  ]
}
```

只是在当前 thread 的模型可见历史末尾追加新的 `ResponseItem`，不提供修改、删除、替换已有历史 item 的能力。可以伪造 assistant 输出、用户消息、工具调用、工具结果等历史 item；但它只是模型上下文层面的伪造，不代表 app-server 真的执行过那些动作，也不会补齐真实事件链。

其实也可以通过直接指定history 然后通过resume 接口来实现类似的功能。

#### 修改历史

没有修改历史的接口，但可以自己修改rollout 文件然后用resume 来实现。

### turn 方法

![ChatGPT Image 2026年6月23日 19_33_02](D:\work\codex\final_docs\app-server.assets\ChatGPT Image 2026年6月23日 19_33_02.png)

#### turn/start

`turn/start` 用来在一个已存在的 thread 上提交一次用户输入，并让 Codex agent 开始或继续处理。

部分参数如下：

- `threadId`：目标thread

- `input`：本 turn 的输入项数组。有如下类型：

  ```json
  type UserInput =
    | { type: "text"; text: string; text_elements: TextElement[] }
  
    | { type: "image"; url: string; detail?: "auto" | "low" | "high" | "original" }
    | { type: "localImage"; path: string; detail?: "auto" | "low" | "high" | "original" }
    | { type: "skill"; name: string; path: string }
    | { type: "mention"; name: string; path: string };//文件插件等
  ```

- `cwd`：覆盖本 turn 及后续 turn 的工作目录。可以传全新的路径，没在thread 启动时候设置过的。

- `approvalPolicy`/`approvalsReviewer`/`sandboxPolicy`：覆盖本轮和接下来的审批策略/审批人/沙箱策略。

- `model`/`effort`：覆盖本轮turn以及接下来使用的模型和思考强度。

- `personality`：覆盖本 turn 及后续 turn 的 personality prompt。

- `summary`：覆盖本轮turn以及后续turn 是否返回模型思考摘要，有如下选择：

  - `"auto"`：让模型/后端自己决定摘要详细程度，通常用这个就行。
  - `"concise"`：请求较简短的推理摘要。
  - `"detailed"`：请求更详细的推理摘要。
  - `"none"`：关闭 reasoning summary。
  - `null` 或不传：不修改当前 thread 的设置，继续沿用已有值或模型默认值。

- `personality`：覆盖本 turn 及后续 turn 的 personality。

- `outputSchema`：仅**约束本 turn 的最终 assistant message 输出格式**，不作为后续 turn 的 sticky setting。如：

  ```json
  {
    "method": "turn/start",
    "params": {
      "threadId": "xxx",
      "input": [
        {
          "type": "text",
          "text": "分析这个 PR"
        }
      ],
      "outputSchema": {
        "type": "object",
        "properties": {
          "summary": { "type": "string" },
          "riskLevel": { "type": "string" },
          "issues": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "required": ["summary", "riskLevel", "issues"]
      }
    }
  }
  ```

接下来的参数是实验字段，需要设置experimentalApi:

- `additionalContext`：用户自己可以自定义传入一些环境上下文，比如：

  ```json
  {
    "method": "turn/start",
    "params": {
      "threadId": "thr_123",
      "input": [
        { "type": "text", "text": "根据当前页面帮我分析一下问题" }
      ],
      "additionalContext": {
        "browser_tab": {
          "kind": "untrusted",
          "value": "Title: Error page\nBody: TypeError: ..."
        },
        "active_file": {
          "kind": "application",
          "value": "path: src/app.ts\nselectedRange: 120-150"
        }
      }
    }
  }
  ```

  这里browser_tab，active_file 都是用户自定义的，这些属于隐藏上下文不会随着用户消息返回，但会发送给模型。核心价值是：**把“用户说的话”和“客户端提供的上下文”分层管理**。普通 `input` 表示用户这轮真正说了什么，`additionalContext` 表示客户端顺手附带的环境状态，总之就是一些适合结构化输入的内容可以放到这里。

- `environments`：本 turn 的环境覆盖。

- `permissions`：选择命名 permission profile。不能和 `sandboxPolicy` 同时传。

- `collaborationMode`：Codex 的“协作方式预设 + 模型设置包”。如：

  ```json
  {
    "collaborationMode": {
      "mode": "plan",
      "settings": {
        "model": "gpt-5.1-codex",
        "reasoning_effort": "medium",
        "developer_instructions": null
      }
    }
  }
  ```

  代表把这次 turn 切到 `plan` 协作模式，用指定模型和 reasoning effort。

#### turn/steer

对于没有结束的turn 追加一条提示词，部分参数如下：

- `threadId`：要 steer 的 thread id。
- `expectedTurnId`：当前 active turn 的 id，不能为空。它是并发保护：如果当前 active turn 不是这个 id，请求会失败，避免把补充输入塞进错误的 turn。
- `input`：同start turn 的input。
- `additionalContext`：同start turn 的additionalContext。

示例：

```json
{
  "id": 42,
  "method": "turn/steer",
  "params": {
    "threadId": "thr_123",
    "expectedTurnId": "turn_abc",
    "clientUserMessageId": "local-msg-002",
    "input": [
      {
        "type": "text",
        "text": "等一下，优先修复刚才测试失败的部分，不要继续重构。",
        "text_elements": []
      }
    ]
  }
}
```

### 一些注意事项和定制功能

![ChatGPT Image 2026年6月23日 19_33_12](D:\work\codex\final_docs\app-server.assets\ChatGPT Image 2026年6月23日 19_33_12.png)

- 子agent 只有大模型主动才能创建，用户没法主动创建。(用户通过提示词"创建一个子agent 来做xxxx"也算大模型创建的)。
  - 但是用户可以使用fork thread 来实现类似或超过子agent 的效果

- 注入自定义工具：通过app-server启动新thread 的时候可以通过dynamicTools 参数来注入自己自定义的工具供大模型使用。
- 启动turn 的时候可以通过outputSchema  来限制大模型输出格式
- 使用app-server 可以主动设置goal