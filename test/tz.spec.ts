import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatLocalTime } from "../src/time_format";
import { initSchema, upsertUserTimezone, type UserProfile } from "../src/db";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = "123456:test_token";

function createTelegramOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createWebhookRequest(update: Record<string, unknown>) {
  return new IncomingRequest(`https://example.com/${TEST_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
}

function createTzUpdate(params?: {
  chatType?: "private" | "group";
  senderId?: number;
  senderUsername?: string;
  messageId?: number;
  replyToMessageId?: number;
  replyUserId?: number;
  replyUsername?: string;
}): Record<string, unknown> {
  const {
    chatType = "private",
    senderId = 7,
    senderUsername = "sender_u",
    messageId = 10,
    replyToMessageId,
    replyUserId = 8,
    replyUsername = "target_u",
  } = params ?? {};

  return {
    update_id: 1,
    message: {
      message_id: messageId,
      date: 1700000000,
      text: "/tz",
      chat: {
        id: 42,
        type: chatType,
      },
      from: {
        id: senderId,
        is_bot: false,
        first_name: "sender",
        username: senderUsername,
      },
      ...(replyToMessageId
        ? {
            reply_to_message: {
              message_id: replyToMessageId,
              date: 1699999999,
              text: "hello",
              chat: {
                id: 42,
                type: chatType,
              },
              from: {
                id: replyUserId,
                is_bot: false,
                first_name: "target",
                username: replyUsername,
              },
            },
          }
        : {}),
    },
  };
}

async function runWebhook(update: Record<string, unknown>): Promise<Response> {
  const request = createWebhookRequest(update);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function createProfile(userId: string, username: string): UserProfile {
  return {
    userId,
    username,
    firstName: username,
    lastName: null,
  };
}

async function readOutboundParam(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  key: string,
): Promise<string | null> {
  const url = input instanceof Request ? input.url : String(input);
  const fromUrl = new URL(url).searchParams.get(key);
  if (fromUrl !== null) {
    return fromUrl;
  }

  const requestBodyText =
    input instanceof Request
      ? await input
          .clone()
          .text()
          .catch(() => "")
      : "";

  if (requestBodyText) {
    try {
      const parsed = JSON.parse(requestBodyText) as Record<string, unknown>;
      const value = parsed[key];
      return value === undefined ? null : String(value);
    } catch {
      const form = new URLSearchParams(requestBodyText);
      const value = form.get(key);
      if (value !== null) {
        return value;
      }
    }
  }

  const initBody = init?.body;
  if (typeof initBody === "string") {
    try {
      const parsed = JSON.parse(initBody) as Record<string, unknown>;
      const value = parsed[key];
      return value === undefined ? null : String(value);
    } catch {
      return new URLSearchParams(initBody).get(key);
    }
  }

  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:00.000Z"));

  await initSchema(env);
  await env.DB.prepare("DELETE FROM chat_users").run();
  await env.DB.prepare("DELETE FROM users").run();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/tz", () => {
  it("自查：未 reply 时查发送者并回复命令消息，群聊写入 sender seen", async () => {
    await upsertUserTimezone(env, createProfile("7", "sender_u"), "Asia/Shanghai");

    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(createTzUpdate({ chatType: "group", messageId: 101 }));
    expect(response.status).toBe(200);
    expect(outboundFetch).toHaveBeenCalledTimes(1);

    const [input, init] = outboundFetch.mock.calls[0];
    const text = await readOutboundParam(input, init, "text");
    const replyTo = await readOutboundParam(input, init, "reply_to_message_id");
    const expected = formatLocalTime("Asia/Shanghai", new Date());

    expect(text).toBe(expected.ok ? expected.value : expected.error);
    expect(replyTo).toBe("101");

    const seenRows = await env.DB.prepare(
      "SELECT user_id FROM chat_users WHERE chat_id = ? ORDER BY user_id ASC",
    )
      .bind("42")
      .all<{ user_id: string }>();

    expect((seenRows.results ?? []).map((row) => row.user_id)).toEqual(["7"]);
  });

  it("回复目标：查 reply_to_message.from.id 并回复被回复消息，群聊写 sender 与 target seen", async () => {
    await upsertUserTimezone(env, createProfile("7", "sender_u"), "Asia/Shanghai");
    await upsertUserTimezone(env, createProfile("8", "target_u"), "Europe/London");

    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(
      createTzUpdate({
        chatType: "group",
        messageId: 201,
        replyToMessageId: 188,
        senderId: 7,
        replyUserId: 8,
      }),
    );
    expect(response.status).toBe(200);
    expect(outboundFetch).toHaveBeenCalledTimes(1);

    const [input, init] = outboundFetch.mock.calls[0];
    const text = await readOutboundParam(input, init, "text");
    const replyTo = await readOutboundParam(input, init, "reply_to_message_id");
    const expected = formatLocalTime("Europe/London", new Date());

    expect(text).toBe(expected.ok ? expected.value : expected.error);
    expect(replyTo).toBe("188");

    const seenRows = await env.DB.prepare(
      "SELECT user_id FROM chat_users WHERE chat_id = ? ORDER BY user_id ASC",
    )
      .bind("42")
      .all<{ user_id: string }>();

    expect((seenRows.results ?? []).map((row) => row.user_id)).toEqual(["7", "8"]);
  });

  it("未登记：提示请私聊 bot 用 /start 初始化", async () => {
    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(createTzUpdate({ chatType: "private", senderId: 77, messageId: 301 }));
    expect(response.status).toBe(200);
    expect(outboundFetch).toHaveBeenCalledTimes(1);

    const [input, init] = outboundFetch.mock.calls[0];
    const text = await readOutboundParam(input, init, "text");
    const replyTo = await readOutboundParam(input, init, "reply_to_message_id");

    expect(text).toBe("请私聊 bot 用 /start 初始化");
    expect(replyTo).toBe("301");
  });
});
