import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatLocalTime, formatUtcOffset } from "../src/time_format";
import { initSchema, markSeen, upsertUserTimezone, type UserProfile } from "../src/db";
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

function createTzaUpdate(params?: {
	chatType?: "private" | "group" | "supergroup";
	chatId?: number;
	senderId?: number;
	messageId?: number;
	text?: string;
}): Record<string, unknown> {
	const { chatType = "group", chatId = 42, senderId = 7, messageId = 10, text = "/tza" } = params ?? {};
	const commandLength = text.split(/\s/u)[0]?.length ?? 0;

	return {
		update_id: 1,
		message: {
			message_id: messageId,
			date: 1700000000,
			text,
			entities: [{ type: "bot_command", offset: 0, length: commandLength }],
			chat: {
				id: chatId,
				type: chatType,
			},
			from: {
				id: senderId,
				is_bot: false,
				first_name: "sender",
				username: "sender_u",
			},
		},
	};
}

function createProfile(userId: string, params?: Partial<UserProfile>): UserProfile {
	return {
		userId,
		username: params?.username ?? null,
		firstName: params?.firstName ?? null,
		lastName: params?.lastName ?? null,
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
			return value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : String(value);
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
			return value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : String(value);
		} catch {
			return new URLSearchParams(initBody).get(key);
		}
	}

	return null;
}

async function readReplyMessageId(input: RequestInfo | URL, init: RequestInit | undefined): Promise<string | null> {
	const raw = await readOutboundParam(input, init, "reply_parameters");
	if (!raw) return null;

	const replyParameters = JSON.parse(raw) as { message_id?: number };
	return replyParameters.message_id === undefined ? null : String(replyParameters.message_id);
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

describe("/tza", () => {
	it("支持 /tza@BotUsername 形式的群聊命令", async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(
			createTzaUpdate({ chatType: "group", messageId: 100, text: "/tza@WallBreakerNO4_Timer_bot" }),
		);
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");
		expect(text).toBe("本群暂无已登记且被识别的成员");
	});

	it("私聊调用时提示仅群聊可用", async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createTzaUpdate({ chatType: "private", messageId: 101 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");
		const replyTo = await readReplyMessageId(input, init);

		expect(text).toBe("仅群聊可用");
		expect(replyTo).toBe("101");
	});

	it("群内无已登记且被识别成员时返回空列表提示", async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createTzaUpdate({ chatType: "group", messageId: 102 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");
		expect(text).toBe("本群暂无已登记且被识别的成员");
	});

	it("群内正常聚合多用户并按昵称/username/user_id 回落展示", async () => {
		const chatId = "42";
		const now = new Date();

		await upsertUserTimezone(
			env,
			createProfile("1001", { username: "alice_u", firstName: "Alice", lastName: "Li" }),
			"Asia/Shanghai",
		);
		await upsertUserTimezone(env, createProfile("1002", { username: "bob_u" }), "Europe/London");
		await upsertUserTimezone(env, createProfile("1003", {}), "America/New_York");

		await markSeen(env, chatId, createProfile("1001", { username: "alice_u", firstName: "Alice", lastName: "Li" }), 1000);
		await markSeen(env, chatId, createProfile("1002", { username: "bob_u" }), 2000);
		await markSeen(env, chatId, createProfile("1003", {}), 1500);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createTzaUpdate({ chatType: "group", messageId: 103 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		const expectedLondon = formatLocalTime("Europe/London", now);
		const expectedNewYork = formatLocalTime("America/New_York", now);
		const expectedShanghai = formatLocalTime("Asia/Shanghai", now);
		const expectedLondonOffset = formatUtcOffset("Europe/London", now);
		const expectedNewYorkOffset = formatUtcOffset("America/New_York", now);
		const expectedShanghaiOffset = formatUtcOffset("Asia/Shanghai", now);

		expect(text).toBe(
			[
				expectedLondon.ok
				? expectedLondonOffset.ok
					? `${expectedLondonOffset.value} (${expectedLondon.value}) | @bob_u`
					: `@bob_u: ${expectedLondonOffset.error}`
				: `@bob_u: ${expectedLondon.error}`,
				expectedNewYork.ok
				? expectedNewYorkOffset.ok
					? `${expectedNewYorkOffset.value} (${expectedNewYork.value}) | 1003`
					: `1003: ${expectedNewYorkOffset.error}`
				: `1003: ${expectedNewYork.error}`,
				expectedShanghai.ok
				? expectedShanghaiOffset.ok
					? `${expectedShanghaiOffset.value} (${expectedShanghai.value}) | Alice Li`
					: `Alice Li: ${expectedShanghaiOffset.error}`
				: `Alice Li: ${expectedShanghai.error}`,
			].join("\n"),
		);
	});

	it("超长消息时截断并提示剩余人数", async () => {
		const chatId = "42";
		for (let index = 1; index <= 140; index += 1) {
			const userId = String(2000 + index);
			const longName = `LongName_${index.toString().padStart(3, "0")}_${"x".repeat(60)}`;
			const profile = createProfile(userId, {
				firstName: longName,
				lastName: "Tail",
				username: `user_${index}`,
			});

			await upsertUserTimezone(env, profile, "Asia/Shanghai");
			await markSeen(env, chatId, profile, 100000 + index);
		}

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createTzaUpdate({ chatType: "supergroup", messageId: 104 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		expect(text).not.toBeNull();
		expect((text ?? "").length).toBeLessThanOrEqual(4096);
		expect(text).toContain("（已截断，剩余 ");
		expect(text).toContain(" 人未显示）");

		const hiddenCount = Number(text?.match(/剩余\s+(\d+)\s+人未显示/)?.[1] ?? "0");
		expect(hiddenCount).toBeGreaterThan(0);
	});
});
