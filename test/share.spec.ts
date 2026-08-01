import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_SHARE, decodeCallbackData, encodeCallbackData } from "../src/callback_data";
import { createEphemeralShare, getEphemeralShare, initSchema } from "../src/db";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = "123456:test_token";
const TEST_BOT_USERNAME = "WallBreakerNO4_Timer_bot";

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

function readOutboundUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

async function readOutboundParam(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  key: string,
): Promise<string | null> {
  const fromUrl = new URL(readOutboundUrl(input)).searchParams.get(key);
  if (fromUrl !== null) {
    return fromUrl;
  }

  const body = input instanceof Request ? await input.clone().text() : typeof init?.body === "string" ? init.body : "";
  if (!body) return null;

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const value = parsed[key];
    return value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return new URLSearchParams(body).get(key);
  }
}

function createShareCallbackUpdate(params: {
  callbackId: number;
  shareId: string;
  senderId?: number;
  receiverId?: number;
  chatId?: number;
  ephemeralMessageId?: number;
}): Record<string, unknown> {
  const {
    callbackId,
    shareId,
    senderId = 7,
    receiverId = 7,
    chatId = 42,
    ephemeralMessageId = 999,
  } = params;

  return {
    update_id: callbackId,
    callback_query: {
      id: callbackId,
      from: {
        id: senderId,
        is_bot: false,
        first_name: "tester",
        username: "tester_u",
      },
      message: {
        message_id: 100,
        ephemeral_message_id: ephemeralMessageId,
        date: 1700000000,
        text: "result",
        chat: {
          id: chatId,
          type: "group",
        },
        from: {
          id: 9,
          is_bot: true,
          first_name: "timer_bot",
        },
        receiver_user: {
          id: receiverId,
          is_bot: false,
          first_name: "tester",
          username: "tester_u",
        },
      },
      data: encodeCallbackData({ action: ACTION_SHARE, id: shareId }),
      chat_instance: "chat_instance_1",
    },
  };
}

async function runWebhook(update: Record<string, unknown>): Promise<Response> {
  const request = createWebhookRequest(update);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request,
    { ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN, TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

beforeEach(async () => {
  await initSchema(env);
  await env.DB.prepare("DELETE FROM chat_users").run();
  await env.DB.prepare("DELETE FROM users").run();
  await env.DB.prepare("DELETE FROM ephemeral_shares").run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("分享到群聊", () => {
  it("分享成功：原文发到群聊并删除临时消息和记录，再 toast 提示", async () => {
    const shareId = await createEphemeralShare(
      env,
      { chatId: "42", receiverUserId: "7", text: "测试分享内容" },
      1700000000000,
    );

    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(createShareCallbackUpdate({ callbackId: 1, shareId }));
    expect(response.status).toBe(200);
    expect(outboundFetch).toHaveBeenCalledTimes(3);

    const sendCall = outboundFetch.mock.calls.find(([input]) =>
      new URL(readOutboundUrl(input)).pathname.includes("/sendMessage"),
    );
    expect(sendCall).toBeDefined();
    expect(await readOutboundParam(sendCall?.[0], sendCall?.[1], "text")).toBe("测试分享内容");
    expect(await readOutboundParam(sendCall?.[0], sendCall?.[1], "receiver_user_id")).toBeNull();

    const deleteCall = outboundFetch.mock.calls.find(([input]) =>
      new URL(readOutboundUrl(input)).pathname.includes("/deleteEphemeralMessage"),
    );
    expect(deleteCall).toBeDefined();
    const deleteBody = JSON.parse(
      deleteCall?.[0] instanceof Request
        ? await deleteCall[0].clone().text()
        : typeof deleteCall?.[1]?.body === "string"
          ? deleteCall[1].body
          : "{}",
    ) as Record<string, unknown>;
    expect(deleteBody).toMatchObject({
      chat_id: "42",
      receiver_user_id: 7,
      ephemeral_message_id: 999,
    });

    const answerCall = outboundFetch.mock.calls.find(([input]) =>
      new URL(readOutboundUrl(input)).pathname.includes("/answerCallbackQuery"),
    );
    expect(answerCall).toBeDefined();
    expect(await readOutboundParam(answerCall?.[0], answerCall?.[1], "text")).toBe("已分享到群聊");

    await expect(getEphemeralShare(env, shareId)).resolves.toBeNull();
  });

  it("非接收者点击时拒绝并提示消息失效，记录保留", async () => {
    const shareId = await createEphemeralShare(
      env,
      { chatId: "42", receiverUserId: "7", text: "测试分享内容" },
      1700000000000,
    );

    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(createShareCallbackUpdate({ callbackId: 2, shareId, senderId: 8, receiverId: 7 }));
    expect(response.status).toBe(200);
    expect(outboundFetch).toHaveBeenCalledTimes(1);

    const [input, init] = outboundFetch.mock.calls[0];
    expect(new URL(readOutboundUrl(input)).pathname).toContain("/answerCallbackQuery");
    expect(await readOutboundParam(input, init, "text")).toBe("消息已失效或已分享");

    await expect(getEphemeralShare(env, shareId)).resolves.not.toBeNull();
  });

  it("重复点击幂等：第二次只提示已失效，不重复发群聊消息", async () => {
    const shareId = await createEphemeralShare(
      env,
      { chatId: "42", receiverUserId: "7", text: "测试分享内容" },
      1700000000000,
    );

    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runWebhook(createShareCallbackUpdate({ callbackId: 3, shareId }))).resolves.toMatchObject({
      status: 200,
    });
    await expect(runWebhook(createShareCallbackUpdate({ callbackId: 4, shareId }))).resolves.toMatchObject({
      status: 200,
    });

    const sendCalls = outboundFetch.mock.calls.filter(([input]) =>
      new URL(readOutboundUrl(input)).pathname.includes("/sendMessage"),
    );
    expect(sendCalls).toHaveLength(1);

    const answerCalls = outboundFetch.mock.calls.filter(([input]) =>
      new URL(readOutboundUrl(input)).pathname.includes("/answerCallbackQuery"),
    );
    expect(answerCalls).toHaveLength(2);
    const lastAnswer = answerCalls[answerCalls.length - 1];
    expect(await readOutboundParam(lastAnswer?.[0], lastAnswer?.[1], "text")).toBe("消息已失效或已分享");
  });

  it("记录缺失时提示消息失效，不发群聊消息", async () => {
    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(createShareCallbackUpdate({ callbackId: 5, shareId: "nonexistent-share-id" }));
    expect(response.status).toBe(200);
    expect(outboundFetch).toHaveBeenCalledTimes(1);

    const [input, init] = outboundFetch.mock.calls[0];
    expect(new URL(readOutboundUrl(input)).pathname).toContain("/answerCallbackQuery");
    expect(await readOutboundParam(input, init, "text")).toBe("消息已失效或已分享");
  });
});

describe("share callback_data 编解码", () => {
  it("编码为 s|<id>，解码还原 id", () => {
    const encoded = encodeCallbackData({ action: ACTION_SHARE, id: "a1b2c3d4e5f6" });
    expect(encoded).toBe("s|a1b2c3d4e5f6");
    expect(decodeCallbackData(encoded)).toEqual({
      ok: true,
      value: { action: ACTION_SHARE, id: "a1b2c3d4e5f6" },
    });
  });

  it("格式错误返回 invalid_share_id，超长返回 too_long", () => {
    expect(decodeCallbackData("s")).toMatchObject({ ok: false, error: { code: "invalid_format" } });
    expect(decodeCallbackData("s|")).toMatchObject({ ok: false, error: { code: "invalid_share_id" } });
    expect(decodeCallbackData("s|a|b")).toMatchObject({ ok: false, error: { code: "invalid_share_id" } });
    expect(decodeCallbackData(`s|${"x".repeat(100)}`)).toMatchObject({ ok: false, error: { code: "too_long" } });
  });
});
