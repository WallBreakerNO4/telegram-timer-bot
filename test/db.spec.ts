import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEphemeralShare,
  deleteEphemeralShare,
  EPHEMERAL_SHARE_TTL_MS,
  getEphemeralShare,
  getUserTimezone,
  initSchema,
  listRegisteredSeenUsers,
  markSeen,
  upsertUserTimezone,
  type UserProfile,
} from "../src/db";

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeUserProfile(userId: string, suffix = ""): UserProfile {
  return {
    userId,
    username: `user_${suffix || userId}`,
    firstName: `first_${suffix || userId}`,
    lastName: `last_${suffix || userId}`,
  };
}

describe("db repo", () => {
  beforeEach(async () => {
    await initSchema(env);
    await env.DB.prepare("DELETE FROM chat_users").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM ephemeral_shares").run();
  });

  it("upsertUserTimezone + getUserTimezone works with string ids", async () => {
    const userId = id("u");
    const profile = makeUserProfile(userId, "a");

    await expect(getUserTimezone(env, userId)).resolves.toBeNull();

    await upsertUserTimezone(env, profile, "Asia/Shanghai", 1700000000000);
    await expect(getUserTimezone(env, userId)).resolves.toBe("Asia/Shanghai");

    await upsertUserTimezone(
      env,
      { ...profile, username: "updated_name" },
      "Europe/London",
      1700000001000,
    );

    await expect(getUserTimezone(env, userId)).resolves.toBe("Europe/London");

    const row = await env.DB.prepare(
      "SELECT user_id, timezone, username, updated_at FROM users WHERE user_id = ?",
    )
      .bind(userId)
      .first<{
        user_id: string;
        timezone: string;
        username: string;
        updated_at: number;
      }>();

    expect(row).toEqual({
      user_id: userId,
      timezone: "Europe/London",
      username: "updated_name",
      updated_at: 1700000001000,
    });
  });

  it("markSeen is idempotent and listRegisteredSeenUsers joins users", async () => {
    const chatId = id("c");
    const registeredUserId = id("u");
    const seenOnlyUserId = id("u");

    const registeredProfile = makeUserProfile(registeredUserId, "reg");
    const seenOnlyProfile = makeUserProfile(seenOnlyUserId, "seen-only");

    await upsertUserTimezone(env, registeredProfile, "Asia/Tokyo", 1700000000100);

    await markSeen(env, chatId, registeredProfile, 1700000000200);
    await markSeen(env, chatId, registeredProfile, 1700000000300);
    await markSeen(env, chatId, seenOnlyProfile, 1700000000400);

    const seenRow = await env.DB.prepare(
      "SELECT last_seen_at FROM chat_users WHERE chat_id = ? AND user_id = ?",
    )
      .bind(chatId, registeredUserId)
      .first<{ last_seen_at: number }>();

    expect(seenRow?.last_seen_at).toBe(1700000000300);

    const users = await listRegisteredSeenUsers(env, chatId);

    expect(users).toEqual([
      {
        userId: registeredUserId,
        timezone: "Asia/Tokyo",
        username: registeredProfile.username ?? null,
        firstName: registeredProfile.firstName ?? null,
        lastName: registeredProfile.lastName ?? null,
        lastSeenAt: 1700000000300,
      },
    ]);
  });

  it("createEphemeralShare + getEphemeralShare + deleteEphemeralShare works", async () => {
    const chatId = id("c");
    const receiverUserId = id("u");
    const shareId = await createEphemeralShare(
      env,
      { chatId, receiverUserId, text: "hello share" },
      1700000000000,
    );

    const share = await getEphemeralShare(env, shareId);
    expect(share).toEqual({
      id: shareId,
      chatId,
      receiverUserId,
      text: "hello share",
      createdAt: 1700000000000,
    });

    await expect(deleteEphemeralShare(env, shareId)).resolves.toBe(true);
    await expect(deleteEphemeralShare(env, shareId)).resolves.toBe(false);
    await expect(getEphemeralShare(env, shareId)).resolves.toBeNull();
  });

  it("createEphemeralShare 顺带清理超过 TTL 的过期记录", async () => {
    const oldId = await createEphemeralShare(
      env,
      { chatId: id("c"), receiverUserId: id("u"), text: "old" },
      1000,
    );
    const freshId = await createEphemeralShare(
      env,
      { chatId: id("c"), receiverUserId: id("u"), text: "fresh" },
      1000 + EPHEMERAL_SHARE_TTL_MS + 1,
    );

    await expect(getEphemeralShare(env, oldId)).resolves.toBeNull();
    const fresh = await getEphemeralShare(env, freshId);
    expect(fresh?.text).toBe("fresh");
  });
});
