## 多agent能力

[toc]

![ChatGPT Image 2026年6月23日 15_05_28](D:\work\codex\final_docs\多agent工具.assets\ChatGPT Image 2026年6月23日 15_05_28.png)

v1 是 thread-id 风格的老式子 agent 控制面；v2 是 task-path + mailbox 风格的新协作模型。默认 MultiAgentV2 是不打开的，需要自己主动配置。

先按 **MultiAgent v1** 看，它就是 multi_agent_v1 namespace 下这 5 个工具：

- multi_agent_v1.spawn_agent
- multi_agent_v1.send_input
- multi_agent_v1.resume_agent
- multi_agent_v1.wait_agent
- multi_agent_v1.close_agent

**只有用户明确要求 sub-agents、子agent 或 parallel agent work这种提示词时才由 当前父 agent 的模型发起。**

### spawn_agent

作用：创建一个新的子 agent 线程，并给它第一条任务消息。

参数核心是：

- message 或 items：二选一，作为子 agent 初始输入。
  - message = 快捷纯文本输入
  - items   = 完整结构化输入
- agent_type：角色，内置default/explorer/worker。这里只是个名字或标签作用。
- model、reasoning_effort(推理挡位)、service_tier(服务优先级)：可选覆盖。
- **fork_context：是否 fork 当前完整历史。**

message 和items

```
{
  "message": "分析 spawn_agent 的实现，并总结调用链。"
}
{
  "items": [
    { "type": "text", "text": "分析这张截图里的 UI 问题。" },
    { "type": "local_image", "path": "D:/work/codex/screenshot.png" }
  ]
}
```

message 或items 作为输入格式都是模型选的，message 是默认选择。只要任务能用一段纯文本说清楚，模型就应该用 message。items 是特殊场景。当模型需要把“纯文本以外的结构化输入”一起交给子 agent，才用。skill 的描述可能会影响模型的选择。

![ChatGPT Image 2026年6月25日 09_54_17](D:\work\codex\final_docs\多agent工具.assets\ChatGPT Image 2026年6月25日 09_54_17.png)

实现逻辑

- 处理输入，设置agent_type等
- 根据输入生成 prompt 预览文本，给事件、UI、日志使用。
- 计算当前子agent深度，并获取配置中的最大深度限制agent_max_depth，校验深度
  - 如果深度超过最大深度限制，报错，后续由模型自己解决这个问题
- 发送 spawn begin 事件给前端UI等显示
- build_agent_spawn_config，构造子 agent 配置，会从父 turn 的当前上下文构造子 agent 配置，比如当前模型，compact prompt，sandbox配置，当前cwd，base instructions等。
- 判断是否fork 父 agent
  - 如果选择fork则禁止传入agent_type，model，reasoning_effort(思考强度)
  - 非 fork 模式下处理模型和角色覆盖
    - apply_requested_spawn_agent_model_overrides，使用显示指定的模型配置(model，reasoning_effort等)
    - apply_role_to_config，根据agent_type配置一些提示词
- apply_spawn_agent_service_tier，校验服务挡位(fast)
- apply_spawn_agent_runtime_overrides，再次同步父进程运行时配置，只是部分配置，防止在之前重建过程中被改掉，比如审批策略/沙县/shell环境策略等，看起来都是安全相关。
- apply_spawn_agent_overrides，如果新子 agent 已经达到最大 depth，源码会在子 config 里禁用子agent，也就是说，这个子 agent 自己可以工作，但不能再继续派新的子 agent。这是 v1 防止无限嵌套的第二层保护。第一层是在父 handler 里阻止超过深度上限；第二层是在达到上限的子 agent 配置里禁用继续协作。
- spawn_agent_with_metadata，根据之前的配置启动子agent 线程，如果需要fork父进程会携带父进程的完整历史上下文。
  - 根据fork 模式进入spawn_forked_thread或spawn_new_thread_with_source  启动新子agent线程
  - 创建好线程后，调用send_input，把第一个任务发给子agent
- 错误处理
- 提取和记录新agent信息，如线程id/agent状态等
- get_agent_config_snapshot，给父进程通知子agent 的信息，如模型/思考强度/role等，因为可能传入参数是一回事，但底层额外解析或默认值补齐可能跟传入不一样。
- 返回给UI显示的内容。
- 返回工具结果给上层(agent_id/nickname)，上层后续可以调用其他多agent工具，如send_input，wait_agent等。

**子 agent 线程是一个完整的 CodexThread，拥有自己的 Session 和 submission_loop；当它收到初始任务后，执行路径和主线程一样，最终就是跑同一个 run_turn(...)。区别只在于它的 session source、thread source、初始历史、配置和父子关系 metadata 不一样。**

### send_input

multi_agent_v1.send_input 的作用是：给一个已经存在的子 agent 再发一条输入。它不等待 agent 回答，只负责把输入提交到目标 agent 的 session queue，成功后返回一个 submission_id。

参数：

- target：必填。目标 agent id，也就是spawn_agent 返回的 agent_id

- message：可选。老式纯文本输入，比如：

  ```json
  {
    "target": "agent-id",
    "message": "继续分析刚才那个模块"
  }
  ```

- items：可选。结构化输入，用来传更丰富的 UserInput，比如 text、image、local_image、skill、mention。跟message二选一

  ```json
  {
    "target": "agent-id",
    "items": [
      { "type": "mention", "name": "drive", "path": "app://google_drive" },
      { "type": "text", "text": "读取这个目录并总结" }
    ]
  }
  ```

- interrupt：可选，默认 false。

  - true 表示先打断目标 agent 当前任务，再让它处理这条新输入。
  - false 表示不打断，作为补充输入排到目标 agent 当前 active turn 的 pending input 里。

### resume_agent 

把一个已经存在过、但当前不在 live manager 里的子 agent 重新恢复成可操作状态。

- 如果目标 agent 当前还活着，就基本不做额外动作，只返回当前状态。

- 如果目标 agent 当前是 NotFound，就尝试从持久化 rollout/history 里恢复它。
- 恢复父 agent 时，还会尝试把它下面状态仍为 Open 的子 agent 树也一起恢复。前提是顶层agent不超过最大子agent层数限制。如果顶层agent 满足层数限制并且回复成功，那么它的子agent即便超过层数限制也会恢复。
  - 恢复父agent 的子agent 的时候，不会恢复被标记为closed 的子agent(可以看后文close_agent)。

参数只有一个：

- id：必填。目标 agent id，也就是spawn_agent 返回的 agent_id

resume_agent 不会发送新 message。恢复后如果要继续让它工作，需要再调用 send_input。

它依赖持久化历史。如果对应 thread/rollout/history 找不到，就会报 agent with id ... not found 或其他 collab tool 错误。

### wait_agent

用来等待一个或多个子 agent 中的任意一个进入“最终状态”。

- 如果超时前没有任何目标进入 final status，就返回 timed out。
- 如果某个目标不存在，会把它当成 not_found final status 返回。

最终状态指这个 agent 当前不会继续正常运行这个 turn 了，wait_agent 可以停止等待并返回：

```
最终状态：
completed      // 完成了，可能带最终回复
errored        // 出错了
shutdown       // 被关闭了
not_found      // 找不到这个 agent
对应的非最终状态是：
pending_init   // 还在初始化
running        // 正在运行
interrupted    // 被打断了，但后面还可能继续接收输入
```

参数

- targets：是必填数组，里面是 spawn_agent 返回的 agent_id。可以传多个，含义是“等这些 agent 里任意一个完成”。
- timeout_ms：是可选的超时时间，单位毫秒。默认是 30000，也就是 30 秒。最小 10000，最大 3600000。

返回

返回结构是：

```json
{
  "status": {
    "agent_id_1": "shutdown"
  },
  "timed_out": false
}
或
{
  "status": {
    "agent_id": {
      "completed": "子 agent 的最终回复内容"
    }
  },
  "timed_out": false
}
```

status 是一个 map，key 通常是 agent id，value 是 agent 状态。

- 最终只会返回已经进入最终形态的agent信息，其他非最终形态的agent信息不会返回。
- **如果调用时已经有多个 agent 处于最终状态，会一起返回。**
- **如果等待过程中一个 agent 刚完成，代码会立刻返回前做一次非阻塞收集，所以“同一瞬间也已经完成”的其他 agent 也可能一起返回。**
- 如果子agent completed 了，会返回子agent 的最终输出，但不影响子agent 那边完成之后触发的inject pending input机制，所以可能会让history 里含有重复的子agent 输出，但格式不一样。

### close_agent

关闭一个已有子 agent，标记closed，并顺手关闭它当前还活着的后代 agent。

- close_agent 会等待 shutdown 完成，不只是提交一个关闭请求。它底层会 wait_until_terminated()。
- 如果你还想拿 agent 的结果，应该先 wait_agent，再 close_agent。如果直接 close 一个正在跑的 agent，它会被 shutdown，当前任务不会自然完成。
- 下属子agent也会同步关闭，但不会标记closed

参数

- target：目标 agent id，也就是spawn_agent 返回的 agent_id

返回

返回对象只有一个字段：

```json
{
  "previous_status": "running"
}
```

previous_status 是关闭前观察到的状态，不是关闭后的最终状态。
