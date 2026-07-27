import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeCallbackData } from "../src/callback_data";
import { getUserTimezone, initSchema } from "../src/db";
import worker from "../src/index";
import { getSupportedTimezones } from "../src/timezones";

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
  if (fromUrl !== null) return fromUrl;

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

function createStartUpdate(chatType: "private" | "group", text = "/start"): Record<string, unknown> {
	const commandLength = text.split(/\s/u)[0]?.length ?? 0;
	return {
		update_id: 1,
		message: {
			message_id: 10,
			date: 1700000000,
			text,
			entities: [{ type: "bot_command", offset: 0, length: commandLength }],
			chat: {
				id: 42,
				type: chatType,
			},
      from: {
        id: 7,
        is_bot: false,
        first_name: "tester",
        username: "tester_u",
      },
    },
  };
}

function createCallbackUpdate(
  callbackId: number,
  callbackData: string,
  messageId = 100,
): Record<string, unknown> {
  return {
    update_id: callbackId,
    callback_query: {
      id: callbackId,
      from: {
        id: 7,
        is_bot: false,
        first_name: "tester",
        username: "tester_u",
      },
      message: {
        message_id: messageId,
        date: 1700000000,
        text: "请选择区域",
        chat: {
          id: 42,
          type: "private",
        },
      },
      data: callbackData,
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/start 与 callback 单消息流", () => {
	it("/start@BotUsername 私聊时也能触发", async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createStartUpdate("private", "/start@WallBreakerNO4_Timer_bot"));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		const [input, init] = outboundFetch.mock.calls[0];
		const callUrl = readOutboundUrl(input);
		const parsed = new URL(callUrl);
		expect(parsed.pathname).toContain("/sendMessage");
		expect(await readOutboundParam(input, init, "text")).toBe("请选择区域");
	});

	it("/changetz@BotUsername 私聊时也能触发", async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createStartUpdate("private", "/changetz@WallBreakerNO4_Timer_bot"));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		const [input, init] = outboundFetch.mock.calls[0];
		const callUrl = readOutboundUrl(input);
		const parsed = new URL(callUrl);
		expect(parsed.pathname).toContain("/sendMessage");
		expect(await readOutboundParam(input, init, "text")).toBe("请选择区域");
	});

	it("/start 非私聊时提示请私聊", async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await runWebhook(createStartUpdate("group"));
    expect(response.status).toBe(200);

    expect(outboundFetch).toHaveBeenCalledTimes(1);
	    const [input, init] = outboundFetch.mock.calls[0];
	    const callUrl = readOutboundUrl(input);
	    const parsed = new URL(callUrl);
	    expect(parsed.pathname).toContain("/sendMessage");
	    expect(await readOutboundParam(input, init, "text")).toBe("请私聊我使用 /start");
  });

  it("start -> 区域 -> 时区 会写入 DB 且每次 callback 都 answer", async () => {
    const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => createTelegramOkResponse(),
    );
    vi.stubGlobal("fetch", outboundFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const supportedTimezones = getSupportedTimezones();
    const selectedTimezone = supportedTimezones.find((timezone) => timezone.includes("/")) ?? "Etc/UTC";
    const region = selectedTimezone.split("/")[0] ?? "Etc";

    await expect(runWebhook(createStartUpdate("private"))).resolves.toMatchObject({ status: 200 });

	    const [startInput, startInit] = outboundFetch.mock.calls[0];
	    const startMarkup = JSON.parse((await readOutboundParam(startInput, startInit, "reply_markup")) ?? "{}");
    const startButtons = (startMarkup.inline_keyboard ?? []).flat() as Array<{ callback_data?: string }>;
    expect(startButtons.some((button) => button.callback_data?.startsWith("r|"))).toBe(true);

    await expect(
      runWebhook(createCallbackUpdate(2, encodeCallbackData({ action: "r", region }))),
    ).resolves.toMatchObject({ status: 200 });

    await expect(
      runWebhook(createCallbackUpdate(3, encodeCallbackData({ action: "t", timezone: selectedTimezone }))),
    ).resolves.toMatchObject({ status: 200 });

    await expect(getUserTimezone(env, "7")).resolves.toBe(selectedTimezone);

    const outboundUrls = outboundFetch.mock.calls.map((call) => readOutboundUrl(call[0]));
    const callbackAnswerCalls = outboundUrls.filter((url) => url.includes("/answerCallbackQuery"));
    expect(callbackAnswerCalls).toHaveLength(2);
    expect(outboundUrls.some((url) => url.includes("/editMessageText"))).toBe(true);
  });
});
