## thread & session

[toc]

![ChatGPT Image 2026年6月23日 16_48_28](D:\work\codex\final_docs\thread & session.assets\ChatGPT Image 2026年6月23日 16_48_28.png)

Thread 管“这条对话/任务线怎么活着、怎么保存、怎么被外部控制”；

Session 管“这条任务线内部怎么构造上下文、怎么跑模型、怎么调工具、怎么进入下一轮”。

### run_turn 外层流程

run_turn 的外层概念，外部输入怎么到run_turn 的，大概有两种情况，初始新建thread 然后再启动新turn和已经有thread 把输入送到thread启动新turn：

```
ThreadStart / ThreadResume / ThreadFork
  -> ThreadManager::start/resume/fork
  -> ThreadManagerState::spawn_thread_with_source(...)
  -> Codex::spawn(...)
  -> Codex::spawn_internal(...)
      -> Config / model / history 解析
      -> 生成 SessionConfiguration { base_instructions, ... }
      -> Session::new(...)
      -> tokio::spawn(submission_loop(rx_sub))
      -> 返回 Codex { tx_sub, session, ... }
  -> finalize_thread_spawn(...)
  -> Arc<CodexThread> 注册到 ThreadManager
  
外部输入 / app-server / SDK / TUI
  -> 找到 thread_id
  -> ThreadManager::get_thread(thread_id)
  -> Arc<CodexThread>
  -> CodexThread::submit(Op::UserInput)
  -> Codex::submit
      -> 生成 Submission { id, op, trace }
      -> tx_sub.send(submission)
  -> submission_loop(rx_sub)
      -> match Op::UserInput
      -> user_input_or_turn_inner
          -> Session::new_turn_with_sub_id
              -> 构造 TurnContext
              -> 设置 active_turn / turn metadata
          -> Session::steer_input
              -> 有 active turn: 写 pending_input
              -> 无 active turn: 返回 NoActiveTurn
          -> Session::spawn_task(..., RegularTask)
              -> abort 旧 task
              -> start_task
              -> active_turn.task = RunningTask
              -> tokio::spawn task.run(...)
          -> RegularTask::run
              -> emit TurnStarted
              -> loop:
                   run_turn(...)
                   如果还有 pending_input，再跑一次 run_turn
```

### 启动新turn

#### ThreadStart

不读取旧历史，只把请求参数转成 `ConfigOverrides`，然后后台调用 `thread_start_task`。它支持一些只有新建时才有的参数，比如 `dynamic_tools`、`environments`、`service_name`、`experimental_raw_events`、`ephemeral`、`personality`。后文app-server 会详细介绍。

#### ThreadResume

每个thread 再threadmanager 中有个map管理，可以理解为有内存缓存，如果缓存还在，就直接把那个设置为活跃，如果缓存不在了就从保存的jsonl中恢复。

#### ThreadFork

从已有thread 的某个会话节点复制，复制出一个全新的thread(全新conversation id)。很多配置直接复用被fork 的会话，并且历史也是直接拷贝被fork 的rollout 文件。

### 关键结构体

#### codex

codex 结构体是core 里一个活跃 agent 会话/线程运行时的句柄。简介如下，里面关键的内容后文会介绍：

```rust
pub struct Codex {
    pub(crate) tx_sub: Sender<Submission>, // 外部给这个 agent 投递操作
    pub(crate) rx_event: Receiver<Event>,  // 这个 agent 往外吐事件
    // Last known status of the agent.
    pub(crate) agent_status: watch::Receiver<AgentStatus>, // 当前 agent 状态的 watch receiver。
    pub(crate) session: Arc<Session>,      // 真正的会话状态和执行上下文
    // Shared future for the background submission loop completion so multiple
    // callers can wait for shutdown.
    pub(crate) session_loop_termination: SessionLoopTermination,//后台 submission_loop 结束的 future。shutdown 时用它等待 session loop 完整退出。
}
```

创建流程，在创建thread 的时候创建

```
外部输入 / app-server / SDK / TUI
  -> 请求 start/create thread
  -> ThreadManager::start_thread(...)
      -> ThreadManagerState::spawn_thread_with_source(...)
          -> Codex::spawn(...)
              -> Session::new(...)
                  -> 生成 conversation_id / thread_id
              -> 创建 Codex { tx_sub, rx_event, session, ... }
          -> CodexThread::new(codex, ...)
          -> threads.insert(thread_id, Arc<CodexThread>)
  -> 返回 thread_id 给外部
```

#### session

`Session` 可以理解成：**一个 live agent 会话的真正状态机**。保存 history、配置、active turn、工具等待状态、模型客户端、MCP、权限、rollout 等运行态。

```rust
pub(crate) struct Session {
    pub(crate) conversation_id: ThreadId,
    pub(crate) installation_id: String,
    pub(super) tx_event: Sender<Event>,
    pub(super) agent_status: watch::Sender<AgentStatus>,
    pub(super) state: Mutex<SessionState>,
    pub(crate) conversation: Arc<RealtimeConversationManager>,
    pub(crate) active_turn: Mutex<Option<ActiveTurn>>,
    pub(crate) input_queue: InputQueue,
    pub(crate) goal_runtime: GoalRuntimeState,
    pub(crate) guardian_review_session: GuardianReviewSessionManager,
    pub(crate) services: SessionServices,
    pub(super) next_internal_sub_id: AtomicU64,
}
```

- conversation_id：这是当前 session 对应的 thread id。虽然名字叫 `conversation_id`，是因为老版本thread 叫conversation。
- installation_id：当前 Codex 安装实例的 id。
- tx_event：这是输出事件通道的发送端。会话内部产生的消息通过这个发送到外部
- agent_status： agent 状态广播器，更像“当前状态快照”。如 running、idle、aborted、failed 这类状态变化，会通过 `watch` 被外部订阅。
- state：**一把异步锁保护起来的会话级状态仓库，里面存 history、配置、上下文、token、compact 等跨 turn 共享数据**。
  - session_configuration：配置
    - base_instructions，基础提示词
    - developer_instructions，开发者提示词
    - personality，个性化提示词
    - ...
  - history：最核心的历史上下文。
  - latest_rate_limits：保存最近一次从模型/API 响应里拿到的 rate limit 信息。
  - mcp_dependency_prompted：记录哪些 MCP dependency 已经提示过用户，避免重复提示。比如某个 MCP server/tool 缺依赖，Codex 已经给用户提示过一次，后面就不想每个 turn 都重复刷同样的提示。
  - additional_context：客户端额外塞进来的上下文片段，它是“客户端附加上下文”，比如 IDE 插件使用的时候应用的当前文件、选区、外部系统补充材料等。
  - previous_turn_settings：记录上一个 regular user turn 使用的设置。比如用的什么模型
  - auto_compact_window：自动压缩窗口的运行时统计状态，判断 token limit、是否需要 auto compact 时，会用这个状态辅助计算。
  - .....
- conversation：实时对话子系统的管理器
- active_turn：当前 session 是否有一个正在运行的 turn/task。保证一个 Session 同一时间最多一个 active task
- input_queue：输入队列，也就是pending_input，再turn运行的时候的用户输入或子agent 返回
- goal_runtime：管理 goal 模式下的运行时状态
- guardian_review_session：安全审查/策略审查相关的内部 agent 会话管理器。
- services：session 运行所需的服务和资源句柄。比如skill mcp等管理句柄。
- next_internal_sub_id：session 内部自增 id，用来生成内部 turn/submission id。

#### Op

`Op` 是 Session 的 mailbox command，也就是外部世界想让当前 agent session 做什么，都统一包装成一个 `Submission { id, op }`，排进 `rx_sub`，再由 `submission_loop` 顺序消费。

Op结构体很长，一共有25项，不逐一分析了，比较关键的几个：

- `UserInput`：最核心的 turn 入口
- `Interrupt`：中断当前 turn
- `Compact`：手动压缩上下文
- `RunUserShellCommand`：用户直接执行 shell，`!cmd`这样
- `ExecApproval` / `PatchApproval`：审批闭环，返回用户审批结果
- `UserInputAnswer` / `RequestPermissionsResponse` ：工具请求的响应，跟上面类似，问用户问题或请求权限等。
- `ThreadSettings`：只改配置，不启动 turn，比如修改cwd工作目录，改审批策略等。
- `InterAgentCommunication`：多 agent 通信，一个 agent 给另一个 agent 发消息。

可以看出基本都是一些用户的前端操作或者前端自动触发的操作，或一些隐藏的外部输入，比如subagent 之间通信等。

