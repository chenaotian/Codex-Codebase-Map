## pending_input

上文介绍了，pending_input就是排队中的输入，run_turn处理的时候会在一次完整调用模型请求之间将排队的pending_input一起全部加到下次调用模型之前的上下文中。

![ChatGPT Image 2026年6月23日 14_42_54](D:\work\codex\final_docs\pending_input.assets\ChatGPT Image 2026年6月23日 14_42_54.png)

### 触发点

真正直接写 TurnState.pending_input.items 的只有两类函数：

1. Session::steer_input
   写入内容：TurnInput::UserInput，以及可能附带的 additional_context。
   典型来源：**用户/agent 在当前 turn 运行中又提交了一条输入。**
   
2. Session::inject_if_running / inject_no_new_turn
   写入内容：TurnInput::ResponseItem。
   特点：只有当前 session 有 active turn 时才进 pending；如果没有 active turn，就直接写 conversation history，不启动新 turn。
   
   典型来源
   
   - **v1 子 agent 完成通知**：completion watcher 调parent_thread.inject_user_message_without_turn(...)。
   - thread/inject_items：codex 的修改/补充历史上下文的接口，有如下触发场景
     - 启动side conversation(侧边聊天/分支对话)的时候，注入SIDE_BOUNDARY_PROMPT(这是一条隐藏提示词，大概告诉模型这是刚fork出来的等等)
     - **appserver 提供的显示调用接口，外部客户端可以调这个接口来使用**
   - 保存用户的批准结果：
     - exec policy amendment：命令执行的批准结果注入历史上下文，如注入“某个命令前缀已经被批准并保存了”
     - network policy amendment：访问网络的批准结果注入历史上下文。
     - Guardian follow-up review reminder：第二次需要模型审查的场景：“你可以参考之前的审查结果，但不要机械沿用；仍然要按 Workspace Policy 重新判断。若用户已经明确批准了之前被拒的具体动作，那可以作为强信号，但也不能违反明确禁止覆盖的策略。”
   - user shell command：**用户自己跑shell命令**，如`!ls`这种。只有当前turn不空闲的时候用户输入命令执行会触发这个，让模型后续能看到你执行的命令。
   - code mode：调用代码工具执行一些代码，代码可以调用notify 函数通知模型一些中间结果。
   - goal 系统：修改目标的时候注入纠偏提示词
     - **在当前turn还在运行的时候外部api修改了goal。会告诉模型”目标被用户修改了“**
     - goal有预算，token 快用完的时候会注入提示词告诉模型尽快工作。
   
3. mailbox 机制

   mailbox 是多agent 工具v2版本用到的。[TODO]v2暂时没分析