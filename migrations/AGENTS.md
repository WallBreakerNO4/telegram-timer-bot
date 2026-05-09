<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-09 | Updated: 2026-05-09 -->

# migrations

## Purpose
Cloudflare D1 数据库迁移文件目录，包含初始化 schema 的 SQL 脚本。

## Key Files

| File | Description |
|------|-------------|
| `0000_init.sql` | 初始 schema——创建 `users` 表（用户时区）与 `chat_users` 表（群聊成员"见过"记录） |

## For AI Agents

### Working In This Directory
- 新增表/字段时，先加 `migrations/xxxx_*.sql`，再同步更新 `src/db.ts:initSchema`
- 迁移文件命名：`NNNN_description.sql`（如 `0001_add_index.sql`）
- 每条 SQL 使用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` 等幂等语句
- 已知坑：workers pool 下 `env.DB.exec()` 多语句可能不稳定；优先每条 `prepare(...).run()`

### Testing Requirements
- 修改迁移后需确保 `src/db.ts:initSchema` 与迁移文件 schema 一致
- 通过 `test/db.spec.ts` 验证

### Common Patterns
- 表以 `user_id` 或 `(chat_id, user_id)` 复合键标识
- 时间戳字段使用 `INTEGER`（Unix timestamp）
- 可选字段不设 `NOT NULL`

## Dependencies

### Internal
- `src/db.ts` - initSchema 需与迁移文件同步

### External
- Cloudflare D1 - SQLite 兼容数据库
