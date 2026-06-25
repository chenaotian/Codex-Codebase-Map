## submission_loop

[toc]

![ChatGPT Image 2026年6月23日 16_47_43](D:\work\codex\final_docs\submission_loop.assets\ChatGPT Image 2026年6月23日 16_47_43.png)

`submission_loop` 是 **Session 输入侧的总调度循环**。它消费 `rx_sub`，也就是 `tx_sub.send(Submission)` 发进来的所有操作，**然后根据 `Op` 分发到对应 handler，**负责把外部指令转成对 `Session`、`active_turn`、工具审批、MCP、compact、rollback、shutdown 等内部状态机的操作，一些关键handler 处理逻辑如下。

### UserInput

![ChatGPT Image 2026年6月25日 12_37_45](D:\work\codex\final_docs\submission_loop.assets\ChatGPT Image 2026年6月25日 12_37_45.png)

**普通对话主入口**，这是最重要的 handler，走user_input_or_turn_inner，大体流程如下：

- user_input_or_turn_inner
  - 解析用户输入的内容，文本，图片等。
  - 创建本轮turn 的TurnContext，new_turn_with_sub_id
    - 如果用户修改了thread 级别的设置，比如模型，思考强度，cwd等
    - 如果用户有本轮的临时设置，比如输出格式schema/environments等
  - 查看是否有active regular turn(当前thread 是否是普通用户聊天并且有活跃turn)，其实很容易理解，主要是看当前如果有正在跑的turn，如果是review 或者compact，自然是没办法追加用户输入的。
    - **有：把当前输入添加到pending_input，然后结束，返回成功**
    - **无：相当于当前thread 空闲，需要新建一个regular turn:**
      - 可能需要刷新mcp servers，refresh_mcp_servers_if_requested
      - 把客户端传入的 `additional_context` 合并进 `SessionState.additional_context`。然后转换成 `TurnInput::ResponseItem`，作为 `task_input` 的前缀。
      - 再把正经的用户输入放入 `task_input` ，也就是additional_context 在前，userinput在后。
      - spawn_task，启动regular task，里面会执行run_turn。

### ExecApproval/PatchApproval

审批闭环，从run_turn开始整个流程大概如下：

```
run_turn
  -> 模型发起 tool call
      -> shell / apply_patch
  -> tool runtime 判断需要审批
  -> Session 注册 pending approval waiter
  -> tx_event 发 ApprovalRequest event 给外部
  -> UI 展示审批
  -> 用户选择允许/拒绝/中止
  -> 外部 submit Op::ExecApproval / Op::PatchApproval
  -> tx_sub/rx_sub
  -> submission_loop
  -> exec_approval / patch_approval handler
  -> notify_approval
  -> 唤醒等待中的 tool
  -> tool 继续执行或失败
  -> run_turn 继续
```

其他需要配合用户交互的其实都差不多。

### InterAgentCommunication

多 agent / 子 agent 通信入口，Codex 的输入不只有人类用户，也可以来自其他 agent。

主 agent 主动派活：

```
主 agent run_turn
  -> 模型调用 assign_task / send_message 工具
  -> tool handler 构造 InterAgentCommunication
  -> AgentControl::send_inter_agent_communication
  -> ThreadManagerState::send_op(child_thread_id, Op::InterAgentCommunication)
  -> child CodexThread::submit
  -> child tx_sub
  -> child submission_loop
  -> inter_agent_communication handler
  -> child input_queue.mailbox
  -> 如果 trigger_turn=true 且 child idle
       -> child maybe_start_turn_for_pending_work
       -> child RegularTask
       -> child run_turn
       -> child 看到 mailbox message
```

子 agent 完成后通知父 agent：

```
child run_turn 完成
  -> child send_event(TurnComplete)
  -> maybe_notify_parent_of_terminal_turn
  -> 构造 InterAgentCommunication(child -> parent, trigger_turn=false)
  -> send_op(parent_thread_id, Op::InterAgentCommunication)
  -> parent submission_loop
  -> parent input_queue.mailbox
  -> 如果 parent 正在 wait_agent
       -> mailbox watch 被唤醒
       -> parent run_turn 继续
  -> 否则等待 parent 下一轮 drain
```
