## skill

[toc]

![ChatGPT Image 2026年6月23日 15_54_59](D:\work\codex\final_docs\skill.assets\ChatGPT Image 2026年6月23日 15_54_59.png)

Skill 通常是一组专门的说明、流程、模板、脚本或参考资料，用来教 Codex 怎么更好地完成某类任务。其实就是一组准备好的提示词。

### skill 格式

**硬格式：`SKILL.md`**
每个 skill 目录必须有 `SKILL.md`，并且文件开头必须是 YAML frontmatter：

```
---
name: my-skill
description: 这个 skill 什么时候该被使用、适合解决什么任务
metadata:
  short-description: 可选的短描述
---

# 这里开始是 Markdown 正文

具体使用步骤、注意事项、要读哪些 references、要跑哪些 scripts...
```

硬性点：

- 文件名必须叫 `SKILL.md`。
- 必须以 `---` 开头，并且有闭合的 `---`。
- frontmatter 必须是合法 YAML。
- `description` 必须非空，最长 1024 字符。
- `name` 实际运行时可以缺省，缺省会用 skill 目录名兜底；但规范/校验脚本要求写上。
- `name` 最长 64 字符。
- `metadata.short-description` 可选，最长 1024 字符。
- 正文是 Markdown，没有强 schema。

**推荐/扩展格式：`agents/openai.yaml`**
这是可选的产品级 metadata，路径固定：

```
my-skill/
  SKILL.md
  agents/
    openai.yaml
```

示例：

```
interface:
  display_name: "My Skill"
  short_description: "一句话展示给 UI"
  icon_small: "./assets/small.png"
  icon_large: "./assets/logo.svg"
  brand_color: "#3B82F6"
  default_prompt: "Use $my-skill to ..."

dependencies:
  tools:
    - type: "mcp"
      value: "github"
      description: "GitHub MCP server"
      transport: "streamable_http"
      url: "https://api.githubcopilot.com/mcp/"

policy:
  allow_implicit_invocation: true
```

这个文件是 **fail open**：坏了通常只是 warn 并忽略 metadata，不会阻止 `SKILL.md` 本体加载。

加载skill后会提取skill信息到`SkillMetadata` 数据结构，比较关键的字段：

- `name` / `description`/`short_description`/`interface`：给模型和 UI 用的标识和描述。
- `path_to_skills_md`：真实 `SKILL.md` 路径。
- `scope`：user/repo/system/admin 等来源。
- `plugin_id`：如果 skill 来自 plugin，会记录 plugin 来源。
- `dependencies`：可以声明工具依赖，目前重点是 MCP dependency。
- `policy`：策略，比如allow_implicit_invocation允许没有用户显示点名的情况加载。

### 加载点

主要有以下加载skill 的时机：

- 初始上下文告诉模型“有哪些 skill”

  ```
  run_turn(...)
    -> run_pre_sampling_compact(...)
    -> record_context_updates_and_set_reference_context_item(...)
         -> build_initial_context(...)
              -> build_available_skills(...)
  ```

  build_available_skills 中会把 `SkillLoadOutcome.skills` (所有skill)渲染成“有哪些 skill 可用”的说明，让模型知道可以按需打开某个 `SKILL.md`。这其中会过滤掉：

  ```
  1. disable 的skill：如果这个 skill 的 `path_to_skills_md` 在 `disabled_paths` 里，就不会出现在给模型的 available skills 列表里。
  2. allow_implicit_invocation：为false 的过滤掉，只能用户点名使用，这个默认为true
  3. 上下文裁剪,看完整的skill说明是否满足budget要求
     - 如果完整列表放得下：全放
     - 放不下，但最小行放得下：只截断压缩description
     - 最小行都放不下：按顺序保留前面的skill，后面的截断
  
  budget:
  如果知道模型 context_window(128k)：
    budget = context_window 的2%
  
  如果不知道 context_window：
    budget = 默认字符数（8000 个字符）
  ```

- 当前 turn 显式提及时注入 skill 内容

  ```
  run_turn
    -> record_context_updates_and_set_reference_context_item
         -> build_initial_context
         -> 注入 available skills 列表
    -> build_skills_and_plugins
         -> collect_explicit_skill_mentions
              -> 从本轮 input 里找显式提到的 skill
         -> maybe_prompt_and_install_mcp_dependencies
              -> 检查显式 skill 的 MCP 依赖，必要时提示安装
         -> build_skill_injections
              -> 读取对应 SKILL.md 正文
              -> 生成 SkillInjection items
         -> record_conversation_items(...)
         		-> 写入 conversation history
  ```

  用户点名skill 的判断依据：

  ```
  结构化 Skill 输入优先：
  	这种通常来自 UI/客户端已经把某个 skill 作为结构化 mention 传进来了：
  	{
        "type": "skill",
        "name": "openai-docs",
        "path": ".codex\\skills\\.system\\openai-docs\\SKILL.md"
      }
      
  带路径的 markdown link：
  	[$alpha-skill](/absolute/path/to/SKILL.md)注意名字腰带$
      [$alpha-skill](skill:///absolute/path/to/SKILL.md) 
      
  $alpha-skill:
  	skill 名字只出现一次
      并且没有同名 connector slug 冲突
      并且该 skill 没有 disabled
      如果有同名则不会选择任何一个
  ```

- 模型自己主动要使用某个skill，模型并不会输出什么格式化输入来调用skill，也没有特定的tool call，而是直接根据skill 的描述中的path，自己主动去打开文件。

- 隐式调用检测

  ```
  maybe_emit_implicit_skill_invocation
  它会检测两种情况：
      模型执行命令读取某个 skill 的 SKILL.md
      模型运行某个 skill 目录下 scripts/ 里的脚本
  检测到之后只做记录，证明模型隐式调用skill了。
  ```

### 总结

skill 的本质其实就是可复用的上下文，核心步骤其实就一个，就是把skill.md塞到上下文里，如果skill 还有其他文件，也都是模型根据skill.md的指引去使用。值得注意的是，当前codex 没有防止重复显示调用skill 的功能，也就是说如果你重复点名使用某个skill，其实是会重复加载这个skill.md的。但根据模型能力，模型一般不会自主的去隐式调用已经加载过的skill。但如果上下文压缩过的话，模型可能会去重复隐式调用。

![image-20260616010847929](D:\work\codex\final_docs\skill.assets\image-20260616010847929.png)
