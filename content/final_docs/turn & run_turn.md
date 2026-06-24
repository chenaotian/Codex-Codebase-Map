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

![ChatGPT Image 2026年6月24日 15_28_48](D:\work\codex\final_docs\turn & run_turn.assets\ChatGPT Image 2026年6月24日 15_28_48.png)

`run_sampling_request` 是 Codex 一次模型 sampling 的内层执行器。它负责为当前 turn 构建工具表、构建 prompt、调用模型流式接口、处理模型输出事件、排队并执行工具调用、把模型输出和工具结果写回会话历史、发送 UI/协议事件、处理 token/ratelimit/diff 信息，并决定外层 `run_turn` 是否需要再发起下一次模型请求。

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