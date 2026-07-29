<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-09 | Updated: 2026-05-09 -->

# test

## Purpose
Vitest 测试套件目录，使用 `@cloudflare/vitest-pool-workers` 在 Workers 模拟环境中运行，覆盖所有命令 handler、DB 操作、路由、时区工具等模块。

## Key Files

| File | Description |
|------|-------------|
| `env.d.ts` | 测试环境类型声明 |
| `tsconfig.json` | 测试专用 TypeScript 配置 |
| `index.spec.ts` | Worker 入口路由测试（token 校验、webhook set、POST 处理） |
| `webhook-routing.spec.ts` | Webhook 路由与 404 测试 |
| `start-flow.spec.ts` | `/start` 命令与 Inline Keyboard 选择流程测试 |
| `db.spec.ts` | D1 数据库操作测试（schema 初始化、CRUD） |
| `tz.spec.ts` | `/tz` 命令测试 |
| `tza.spec.ts` | `/tza` 命令测试 |
| `tzm.spec.ts` | `/tzm` 命令测试（含 OpenRouter 请求与 Structured Outputs 解析） |
| `timezones.spec.ts` | 时区列表、区域、分页工具函数测试 |

## For AI Agents

### Working In This Directory
- 使用 `cloudflare:test` 的 `createExecutionContext()` + `waitOnExecutionContext(ctx)` + `env`
- mock 外部 `fetch`：`vi.stubGlobal('fetch', ...)`；`afterEach` 中 `vi.unstubAllGlobals()` 与 `vi.restoreAllMocks()` 清理
- 时间相关用 `vi.useFakeTimers()` + `vi.setSystemTime(...)`，`afterEach` 还原
- 断言 Telegram API 调用时解析 `URL`/`URLSearchParams`/JSON body，不做脆弱的整串 URL 匹配

### Testing Requirements
- 行为改动必须补或改对应的 `test/*.spec.ts`
- 部署前 `pnpm test` 全量通过

### Common Patterns
- 使用 `SELF.fetch` 模拟 HTTP 请求到 Worker
- D1 测试使用 test pool 提供的 D1 binding
- 每个 `describe` 块对应一个功能模块
- 测试结构：`describe("模块名", () => { it("应该...", async () => { ... }) })`

## Dependencies

### Internal
- `src/` - 所有被测模块

### External
- `vitest` - 测试框架
- `@cloudflare/vitest-pool-workers` - Workers 环境模拟
- `cloudflare:test` - Workers 测试工具（`env`、`createExecutionContext`、`waitOnExecutionContext`、`SELF`）
