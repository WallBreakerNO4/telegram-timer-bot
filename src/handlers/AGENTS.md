<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-09 | Updated: 2026-05-09 -->

# handlers

## Purpose
Telegram Bot 的命令（command）与回调（callback）处理器，每个文件通过 `register*Handler` 函数向 grammY `Bot` 实例注册。

## Key Files

| File | Description |
|------|-------------|
| `callback.ts` | Inline Keyboard callback 处理：时区选择流程（区域→分页→时区→保存） |
| `start.ts` | `/start` 与 `/changetz` 命令：私聊中展示区域选择器 Inline Keyboard |
| `timezone_keyboard.ts` | Inline Keyboard 视图层：区域选择器、时区分页列表、按钮编码 |
| `tz.ts` | `/tz` 命令：查询自己或 reply 目标的当地时间（含 UTC 偏移） |
| `tza.ts` | `/tza` 命令：汇总群聊中已登记且"见过"的成员当地时间（带截断） |
| `tzm.ts` | `/tzm` 命令：自然语言时间→OpenRouter Structured Outputs→按成员时区展示；支持回复他人消息解析 |

## For AI Agents

### Working In This Directory
- 每个 handler 文件导出一个 `register*Handler(bot, ...)` 函数
- 注册模式：`bot.on('command', async (ctx) => { ... })` 或 `bot.on(':callback', ...)`
- Handler 统一返回 `Promise<Response>`，通常返回 `new Response('ok')`
- Telegram API 调用使用 grammY 的 `ctx.reply`、`ctx.answerCallbackQuery`、`ctx.api` 原生签名
- 新增命令需同时在 `src/bot.ts:createBot` 中注册

### Testing Requirements
- 每个 handler 的行为改动需在对应 `test/*.spec.ts` 中补充用例
- 测试文件命名：`test/<handler_name>.spec.ts`（如 `tz.spec.ts`）

### Common Patterns
- 消息文本默认不设置 `parse_mode`，按纯文本发送
- 群聊私聊判断：`message.chat.type === 'private'` vs `'group'/'supergroup'`
- 回复模式用 `message.reply_to_message` 获取目标消息
- Inline Keyboard 通过 `callback_data.ts` 进行编解码（64 bytes 限制）
- 数据库写入前调用 `initSchema(env)` 确保表存在

## Dependencies

### Internal
- `src/callback_data.ts` - callback data 编解码
- `src/db.ts` - 用户时区、群聊记录 CRUD
- `src/telegram_profiles.ts` - 用户信息提取
- `src/telegram_text.ts` - 文本拼装与截断
- `src/time_format.ts` - 时区时间格式化
- `src/timezones.ts` - 时区列表与分页
- `src/tzm_ai.ts` - AI 解析（仅 `tzm.ts`）

### External
- `grammy` - `Bot`、`Context`
- `openai` - OpenRouter 的 OpenAI 兼容客户端与 Structured Outputs parser
