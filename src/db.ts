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

const SQL_CREATE_USERS = `
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      updated_at INTEGER
    )
    `;

const SQL_CREATE_CHAT_USERS = `
    CREATE TABLE IF NOT EXISTS chat_users (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY(chat_id, user_id)
    )
    `;

const SQL_CREATE_EPHEMERAL_SHARES = `
    CREATE TABLE IF NOT EXISTS ephemeral_shares (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      receiver_user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
    `;

const SQL_GET_USER_TIMEZONE = "SELECT timezone FROM users WHERE user_id = ?";

const SQL_UPSERT_USER = `
    INSERT INTO users (user_id, timezone, username, first_name, last_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      timezone = excluded.timezone,
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = excluded.updated_at
    `;

const SQL_MARK_SEEN = `
    INSERT INTO chat_users (chat_id, user_id, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at
    `;

const SQL_LIST_REGISTERED_SEEN_USERS = `
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
    `;

const SQL_INSERT_EPHEMERAL_SHARE = `
    INSERT INTO ephemeral_shares (id, chat_id, receiver_user_id, text, created_at)
    VALUES (?, ?, ?, ?, ?)
    `;

const SQL_GET_EPHEMERAL_SHARE = `
    SELECT id, chat_id, receiver_user_id, text, created_at
    FROM ephemeral_shares
    WHERE id = ?
    `;

const SQL_DELETE_EPHEMERAL_SHARE = "DELETE FROM ephemeral_shares WHERE id = ?";

const SQL_DELETE_EXPIRED_EPHEMERAL_SHARES = "DELETE FROM ephemeral_shares WHERE created_at < ?";

export const EPHEMERAL_SHARE_TTL_MS = 24 * 60 * 60 * 1000;

export interface EphemeralShare {
  id: string;
  chatId: string;
  receiverUserId: string;
  text: string;
  createdAt: number;
}

export async function initSchema(env: DbEnv): Promise<void> {
  await env.DB.prepare(SQL_CREATE_USERS).run();
  await env.DB.prepare(SQL_CREATE_CHAT_USERS).run();
  await env.DB.prepare(SQL_CREATE_EPHEMERAL_SHARES).run();
}

export async function getUserTimezone(env: DbEnv, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(SQL_GET_USER_TIMEZONE)
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
  await env.DB.prepare(SQL_UPSERT_USER)
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
  await env.DB.prepare(SQL_MARK_SEEN)
    .bind(chatId, userProfile.userId, now)
    .run();
}

export async function listRegisteredSeenUsers(
  env: DbEnv,
  chatId: string,
): Promise<SeenRegisteredUser[]> {
  const result = await env.DB.prepare(SQL_LIST_REGISTERED_SEEN_USERS)
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

function generateShareId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createEphemeralShare(
  env: DbEnv,
  params: { chatId: string; receiverUserId: string; text: string },
  now: number = Date.now(),
): Promise<string> {
  const id = generateShareId();
  await env.DB.prepare(SQL_DELETE_EXPIRED_EPHEMERAL_SHARES).bind(now - EPHEMERAL_SHARE_TTL_MS).run();
  await env.DB.prepare(SQL_INSERT_EPHEMERAL_SHARE)
    .bind(id, params.chatId, params.receiverUserId, params.text, now)
    .run();
  return id;
}

export async function getEphemeralShare(env: DbEnv, id: string): Promise<EphemeralShare | null> {
  const row = await env.DB.prepare(SQL_GET_EPHEMERAL_SHARE)
    .bind(id)
    .first<{
      id: string;
      chat_id: string;
      receiver_user_id: string;
      text: string;
      created_at: number;
    }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    chatId: row.chat_id,
    receiverUserId: row.receiver_user_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

export async function deleteEphemeralShare(env: DbEnv, id: string): Promise<boolean> {
  const result = await env.DB.prepare(SQL_DELETE_EPHEMERAL_SHARE).bind(id).run();
  return result.meta.changes === 1;
}
