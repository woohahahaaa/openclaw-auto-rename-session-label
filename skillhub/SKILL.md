---
name: auto-rename-session-label
slug: auto-rename-session-label
displayName: 自动重命名会话标题
version: 1.0.0
description: "安装一个 OpenClaw internal hook：在 message:received 时，用该会话当前使用的模型自动为新会话生成简短标题；失败时安全降级为截断首条消息。触发词：安装自动重命名会话标题、自动给会话起标题、会话自动重命名、自动命名会话、auto rename session label、auto title sessions。"
metadata:
  homepage: https://github.com/openclaw/openclaw
  license: MIT
  allowed-tools: "read,write,edit,exec"
---

# 自动重命名会话标题（OpenClaw hook 安装器）

> **触发词（最高优先级）：** 安装自动重命名会话标题、自动给会话起标题、会话自动重命名、
> 自动命名会话、auto rename session label、auto title sessions。
> 看到 / 听到任何一个 → 立即执行下方安装流程。

本 skill 安装一个名为 `auto-rename-session-label` 的 **OpenClaw internal hook**。
安装并启用后，每当一个尚无标题的会话收到消息，该 hook 会用**该会话当前正在使用
的同款模型**生成一个简短标题，并写入会话的 `label` 字段。任何环节失败时，会降级为
截取首条用户消息，因此标题一定会被写入。

该 hook 完全可移植——**不含任何写死的路径，也不含任何个人信息**；它在运行时动态
解析 OpenClaw home、agent id 以及 OpenClaw `dist` 目录。

## 包内容

```
auto-rename-session-label/
├── SKILL.md            # 本文件（SkillHub 入口）
├── README.md
├── LICENSE
└── hook/
    ├── HOOK.md         # hook 自身的元数据 + 文档
    └── handler.ts      # hook 实现（可移植）
```

`hook/` 是一个可直接放置的 OpenClaw internal hook 目录。

## 安装流程

1. 解析 OpenClaw home 目录：若设置了 `OPENCLAW_HOME` 则用它，否则用 `~/.openclaw`。
2. 把包内的 `hook/` 目录复制到 managed hooks 目录：

   ```bash
   OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
   SKILL_DIR="<本 skill 目录的绝对路径>"
   mkdir -p "$OPENCLAW_HOME/hooks/auto-rename-session-label"
   cp "$SKILL_DIR/hook/HOOK.md" "$SKILL_DIR/hook/handler.ts" \
      "$OPENCLAW_HOME/hooks/auto-rename-session-label/"
   ```

   > 把 `<SKILL_DIR>` 解析为本 SKILL.md 实际所在目录（即本文件的父目录）。
   > 不要凭空猜一个绝对路径。

3. 启用该 hook（这是必需步骤；`hooks.internal.entries.*` 是受保护的配置路径，
   无法通过 `gateway config.patch` 设置——必须用 CLI）：

   ```bash
   openclaw hooks enable auto-rename-session-label
   ```

4. 重启或重载 gateway 让 hook 加载，然后验证：

   ```bash
   openclaw hooks list        # auto-rename-session-label 应显示 ✓ ready
   openclaw hooks info auto-rename-session-label
   ```

## 验证是否生效

新建一个会话并发一条消息。回复之后，该会话在
`~/.openclaw/agents/<agentId>/sessions/sessions.json` 里的条目应当有一个由模型
生成的简短 `label`（而不是把你的消息截断后的副本）。

如果标题总是你首条消息的截断副本，说明 LLM 分支失败走了降级。检查
`openclaw hooks info auto-rename-session-label` 和 gateway 日志；最常见的原因是
被代理的模型 `maxTokens` 太小（本 hook 已用 1024 规避该问题）。

## 卸载

```bash
openclaw hooks disable auto-rename-session-label
rm -rf "${OPENCLAW_HOME:-$HOME/.openclaw}/hooks/auto-rename-session-label"
```

## 说明

- 本 hook 属于"由 operator 管理的副作用" hook（它写入会话 `label` 字段），
  不修改 prompt、工具或消息流。
- 完整实现细节见 `hook/HOOK.md`。
