<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-09 | Updated: 2026-05-09 -->

# src

## Purpose
应用源码目录，包含 Cloudflare Workers 入口、Telegram Bot 实例装配、D1 数据库层、纯工具函数、Telegram 消息 helper 以及命令/callback 处理器。

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Worker 入口，路由边界——token 校验、webhook set、update 分发 |
| `bot.ts` | Bot 实例装配，注册所有命令/callback handler |
| `env.d.ts` | Cloudflare 环境变量类型声明（`SECRET_TELEGRAM_API_TOKEN` 等） |
| `db.ts` | D1 数据库层：schema 初始化、用户时区 CRUD、群聊"见过"记录 |
| `callback_data.ts` | Inline Keyboard callback data 的编解码（64 bytes 限制） |
| `telegram_profiles.ts` | 从 Telegram update 提取用户信息、展示名生成 |
| `telegram_text.ts` | 文本拼装与截断（受 Telegram 4096 字符限制） |
| `telegram_webhook.ts` | Telegram webhook 设置逻辑 |
| `time_format.ts` | 纯函数：时区本地时间格式化、UTC 偏移计算（使用 `Intl.DateTimeFormat`） |
| `timezones.ts` | 纯函数：获取运行时支持的 IANA 时区列表、区域列表、分页 |
| `tzm_ai.ts` | `/tzm` AI 相关：system prompt、Zod Structured Outputs schema、业务校验、周期表达式检测 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `handlers/` | Telegram 命令与 callback 处理器（见 `handlers/AGENTS.md`） |

## For AI Agents

### Working In This Directory
- 新增文件遵循 `snake_case.ts` 命名
- 第三方 import 在前，本地相对路径在后；两组之间空一行
- 优先 type-only import：`import { type Foo } from '...'`
- 可预期失败使用 result union 模式，不随意 throw
- 纯逻辑函数尽量无副作用；外部 I/O 集中在边界

### Testing Requirements
- 每个模块的行为改动需有对应的 `test/*.spec.ts` 覆盖
- 新增 handler 需在对应测试文件补充用例

### Common Patterns
- Bot handler 注册模式：`bot.on('command', async (ctx) => { ... })`
- D1 操作：`env.DB.prepare(sql).bind(...).run()/first()/all()`
- 时间处理：`Intl.DateTimeFormat` + `formatToParts` 获取各时区时间部分
- Telegram API 调用使用 grammY 的 `ctx.reply`、`ctx.answerCallbackQuery`、`ctx.api` 原生签名

## Dependencies

### Internal
- `handlers/` - 各命令的处理器实现

### External
- `grammy` - Telegram Bot 框架（提供 `Bot`、`Context`、Cloudflare webhook 适配器）
- `openai` - 通过 OpenRouter OpenAI 兼容端点执行 `/tzm` 推理
- `zod` - 生成 strict JSON Schema 并解析 Structured Outputs
- Cloudflare Workers runtime - `Intl.supportedValuesOf`、D1、outbound `fetch`
