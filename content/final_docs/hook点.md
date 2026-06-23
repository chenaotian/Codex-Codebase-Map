## hook点

![ChatGPT Image 2026年6月23日 14_56_18](D:\work\codex\final_docs\hook点.assets\ChatGPT Image 2026年6月23日 14_56_18.png)

共有以下hook点位：

| Hook 点           | 触发时机                               | matcher                            |
| ----------------- | -------------------------------------- | ---------------------------------- |
| SessionStart      | 会话启动/恢复/清空/compact 后启动时    | startup / resume / clear / compact |
| SubagentStart     | thread-spawn 子代理启动时              | agent_type                         |
| UserPromptSubmit  | 用户输入写入 history 前                | 无，matcher 会被忽略               |
| PreToolUse        | 工具真正执行前                         | tool name / alias                  |
| PermissionRequest | 需要权限/审批时，在 UI/guardian 审批前 | tool name / alias                  |
| PostToolUse       | 工具成功执行并产出结果后               | tool name / alias                  |
| PreCompact        | compact 任务执行前                     | compact trigger                    |
| PostCompact       | compact 成功后                         | compact trigger                    |
| Stop              | 普通 turn 准备结束时                   | 无，matcher 会被忽略               |
| SubagentStop      | thread-spawn 子代理 turn 准备结束时    | agent_type                         |

最常用流程：

1. 选 hook 点，比如 PreToolUse / Stop / UserPromptSubmit
2. 写一个脚本，读取 stdin
3. 在 .codex/hooks.json 或 config.toml 里注册这个脚本
4. 开启 hooks feature，并信任这个 hook

**示例：拦截危险 Bash 命令**

项目级配置可以放在：

```
D:\work\codex\.codex\hooks.json
```

内容：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "commandWindows": "python D:\\work\\codex\\.codex\\hooks\\pre_tool_guard.py",
            "command": "python3 D:/work/codex/.codex/hooks/pre_tool_guard.py",
            "timeout": 10,
            "statusMessage": "checking shell command"
          }
        ]
      }
    ]
  }
}
```

脚本：

```python
import json
import sys

payload = json.load(sys.stdin)
tool_input = payload.get("tool_input") or {}
command = tool_input.get("command", "")

dangerous = ["rm -rf", "git reset --hard", "Remove-Item -Recurse"]

if any(x in command for x in dangerous):
    print(json.dumps({
        "decision": "block",
        "reason": f"blocked dangerous command: {command}"
    }))
else:
    print("{}")
```

如果hook里需要调用大模型，则codex 没有提供接口，只有自己通过代码调用能用api_key调用的大模型。或者代码里再通过start/turn这种方式调用codex。