## rollout 文件

![ChatGPT Image 2026年6月23日 16_38_48](D:\work\codex\final_docs\rollout文件.assets\ChatGPT Image 2026年6月23日 16_38_48.png)

是 Codex 一次会话/线程的可重放日志，可以理解成是会话的存档，把会话过程按 JSONL 追加保存下来，之后用它做 resume、fork、rollback、历史列表、搜索、元数据索引、memory 输入，以及调试 trace。

把 rollout JSONL 理解成“很多行带时间戳的事件/状态记录”。每一行顶层都是这个形状：

```json
{"timestamp":"2026-06-20T10:00:00.000Z","type":"...","payload":{...}}
```

json中的type 也就是RolloutItem 一共 **5 种**，定义在

1. `session_meta`
2. `response_item`
3. `compacted`
4. `turn_context`
5. `event_msg`

其中 `response_item` 自己还有 **15 种子类型**，`event_msg` 源码里有 **74 种子类型**，但默认 rollout 不会全保存，只保存对恢复会话有用的那部分。

关键的保存信息：

- 用户输入：完整保留
- 工具调用：完整保留
- 工具调用输出：完整保留(保留内容跟模型看到的一样)
- 模型最终输出：完整保留
- 模型思考：加密保存
- remote 上下文压缩：加密保存