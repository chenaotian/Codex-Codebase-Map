## plan模式与plan工具

[toc]

### 总览

![ChatGPT Image 2026年6月23日 11_52_20](D:\work\codex\final_docs\plan模式与plan工具.assets\ChatGPT Image 2026年6月23日 11_52_20.png)

### plan模式

**plan模式本质也是走run_turn，只不过其中设置了一个模式标志位，然后默认提示词有区别，输出处理有区别**：

```
Plan 模式 = 同一个 run_turn
          + collaboration_mode 切到 Plan
          + 注入 Plan 专用 developer instructions
          + Plan 专用 streaming/proposed_plan 解析
          + 一些工具行为差异
          + 可能不同 reasoning effort
```

**模型在 Plan 模式下边流式输出文字时，Codex 会实时识别其中的 <proposed_plan>...</proposed_plan> 块，把它从普通 assistant 文本里拆出来，作为特殊的 Plan UI 事件显示。**

最后生成的计划本质是一个markdown 文本，然后给前端显示，让用户选择是否执行计划，如果用户选择执行计划，客户端会切到 Default 模式，然后在上下文中增加一条”执行计划“的提示词。然后继续，由于没有清空上下文，所以模型还是能看到计划的。如果用户选择清空上下文再继续，则会重新插入初始提示词和计划。

### plan tool

#### update_plan

更新 UI 里的任务进度 checklist，状态只有：

```
pending
in_progress
completed
```

参数大概是：

```json
{
  "explanation": "optional text",
  "plan": [
    { "step": "read files", "status": "in_progress" },
    { "step": "patch bug", "status": "pending" }
  ]
}
```

但是在plan模式中无法使用，只能在默认模式中使用（显而易见，先有计划才能更新计划）。

#### request_user_input

这是 Plan 模式里用来问用户关键问题的工具。

参数：

```json
{
  "questions": [
    {
      "id": "scope",
      "header": "Scope",
      "question": "Should this change include tests?",
      "options": [
        {
          "label": "Yes (Recommended)",
          "description": "Adds confidence and prevents regressions."
        },
        {
          "label": "No",
          "description": "Keeps the change smaller."
        }
      ]
    }
  ]
}
```

它会暂停当前 turn，客户端弹出问题等用户回答，然后把用户选择作为工具结果返回给模型。Plan 模式提示词里也明确要求：重要决策优先用这个工具问用户。

### 总结

Plan 模式提升的是前端的计划可见性、用户确认和模型遵循计划的概率；它不是形式化执行引擎，也没有内建机制证明或强制计划被完整、正确地执行。