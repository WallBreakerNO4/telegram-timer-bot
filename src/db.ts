export interface UserProfile {
  userId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface SeenRegisteredUser {
  userId: string;
  timezone: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  lastSeenAt: number;
}

type DbEnv = Pick<Env, "DB">;

export async function initSchema(env: DbEnv): Promise<void> {
  await env.DB.prepare(
    `
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      updated_at INTEGER
    )
    `,
  ).run();

  await env.DB.prepare(
    `
    CREATE TABLE IF NOT EXISTS chat_users (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY(chat_id, user_id)
    )
    `,
  ).run();
}

export async function getUserTimezone(env: DbEnv, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT timezone FROM users WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ timezone: string }>();

  return row?.timezone ?? null;
}

export async function upsertUserTimezone(
  env: DbEnv,
  userProfile: UserProfile,
  timezone: string,
  now: number = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO users (user_id, timezone, username, first_name, last_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      timezone = excluded.timezone,
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      userProfile.userId,
      timezone,
      userProfile.username ?? null,
      userProfile.firstName ?? null,
      userProfile.lastName ?? null,
      now,
    )
    .run();
}

export async function markSeen(
  env: DbEnv,
  chatId: string,
  userProfile: UserProfile,
  now: number = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO chat_users (chat_id, user_id, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at
    `,
  )
    .bind(chatId, userProfile.userId, now)
    .run();
}

export async function listRegisteredSeenUsers(
  env: DbEnv,
  chatId: string,
): Promise<SeenRegisteredUser[]> {
  const result = await env.DB.prepare(
    `
    SELECT
      u.user_id,
      u.timezone,
      u.username,
      u.first_name,
      u.last_name,
      cu.last_seen_at
    FROM chat_users cu
    INNER JOIN users u ON u.user_id = cu.user_id
    WHERE cu.chat_id = ?
    ORDER BY cu.last_seen_at DESC, u.user_id ASC
    `,
  )
    .bind(chatId)
    .all<{
      user_id: string;
      timezone: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      last_seen_at: number;
    }>();

  return (result.results ?? []).map((row) => ({
    userId: row.user_id,
    timezone: row.timezone,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    lastSeenAt: row.last_seen_at,
  }));
}
