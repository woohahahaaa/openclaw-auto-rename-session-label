# Auto Rename Session Label

An OpenClaw internal **hook** that automatically titles new chat sessions.

When a message arrives for a session that has no title yet, the hook asks the
**same model that session is currently using** to produce a short title and
stores it as the session `label`. If anything fails (no model, timeout, upstream
error), it falls back to truncating the first user message — so a label is always
written.

Works on **WebChat / Control UI / any channel** — fills the gap until OpenClaw
ships official auto-titling for these surfaces (Telegram and Discord already
have it natively).

## Two SKILL.md variants

This repo ships two language variants of the same skill, mirroring what's
published on each hub:

| Path | Language | Mirrors |
|------|----------|---------|
| [`clawhub/SKILL.md`](./clawhub/SKILL.md) | English | [ClawHub](https://clawhub.ai/) (`clawhub install auto-rename-session-label`) |
| [`skillhub/SKILL.md`](./skillhub/SKILL.md) | 中文 | [SkillHub](https://skill.xfyun.cn/) (`skillhub install auto-rename-session-label`) |

The runtime code (the hook itself, under [`hook/`](./hook)) is identical for
both. Only the SKILL.md describing the install procedure differs in language.

## Install

### Option 1: From SkillHub (中文使用者推荐)

```bash
skillhub install auto-rename-session-label
```

### Option 2: From ClawHub (English users)

```bash
clawhub install auto-rename-session-label
```

### Option 3: Manual

```bash
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
mkdir -p "$OPENCLAW_HOME/hooks/auto-rename-session-label"
curl -sSL https://gh-proxy.com/https://raw.githubusercontent.com/woohahahaaa/openclaw-auto-rename-session-label/main/hook/HOOK.md \
  -o "$OPENCLAW_HOME/hooks/auto-rename-session-label/HOOK.md"
curl -sSL https://gh-proxy.com/https://raw.githubusercontent.com/woohahahaaa/openclaw-auto-rename-session-label/main/hook/handler.js \
  -o "$OPENCLAW_HOME/hooks/auto-rename-session-label/handler.js"
# Then restart your gateway.
```

## License

MIT — see [LICENSE](./LICENSE).
