import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function registerSeenMember(
	chatId: string,
	userId: string,
	timezone: string,
	profileParams: Partial<UserProfile>,
	lastSeenAt: number,
): Promise<void> {
	const profile = createProfile(userId, profileParams);
	await upsertUserTimezone(env, profile, timezone);
	await markSeen(env, chatId, profile, lastSeenAt);
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

	it("按当地时间聚合示例，并使用伦敦夏令时的实际偏移", async () => {
		vi.setSystemTime(new Date("2026-07-27T13:30:00.000Z"));
		const chatId = "42";
		await registerSeenMember(chatId, "1001", "Asia/Shanghai", { firstName: "Alice" }, 5000);
		await registerSeenMember(chatId, "1002", "Asia/Shanghai", { firstName: "Bob" }, 4000);
		await registerSeenMember(chatId, "1003", "Asia/Shanghai", { firstName: "Carol" }, 3000);
		await registerSeenMember(chatId, "1004", "Europe/London", { firstName: "Dave" }, 2000);
		await registerSeenMember(chatId, "1005", "Europe/London", { firstName: "Eve" }, 1000);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		const response = await runWebhook(createTzaUpdate({ chatType: "group", messageId: 103 }));
		expect(response.status).toBe(200);
		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		expect(text).toBe(
			[
				"2026-07-27 · UTC+8 · 21:30",
				"Asia/Shanghai：Alice、Bob、Carol",
				"",
				"2026-07-27 · UTC+1 · 14:30",
				"Europe/London：Dave、Eve",
			].join("\n"),
		);
	});

	it("相同当地日期和时间但不同 IANA 时区时共用时间块并分行", async () => {
		vi.setSystemTime(new Date("2026-07-27T13:30:00.000Z"));
		const chatId = "42";
		await registerSeenMember(chatId, "1101", "Asia/Shanghai", { firstName: "Alice" }, 2000);
		await registerSeenMember(chatId, "1102", "Asia/Manila", { username: "bob_u" }, 1000);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runWebhook(createTzaUpdate({ messageId: 104 }));
		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		expect(text).toBe(
			[
				"2026-07-27 · UTC+8 · 21:30",
				"Asia/Manila：@bob_u",
				"Asia/Shanghai：Alice",
			].join("\n"),
		);
	});

	it("显示非整小时 UTC 偏移", async () => {
		vi.setSystemTime(new Date("2026-07-27T13:30:00.000Z"));
		await registerSeenMember("42", "1201", "Asia/Kathmandu", { firstName: "Nima" }, 1000);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runWebhook(createTzaUpdate({ messageId: 105 }));
		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		expect(text).toBe(
			[
				"2026-07-27 · UTC+5:45 · 19:15",
				"Asia/Kathmandu：Nima",
			].join("\n"),
		);
	});

	it("跨当地日期时拆成多个日期段", async () => {
		vi.setSystemTime(new Date("2026-07-27T23:30:00.000Z"));
		const chatId = "42";
		await registerSeenMember(chatId, "1301", "Pacific/Kiritimati", { firstName: "Tomorrow" }, 2000);
		await registerSeenMember(chatId, "1302", "America/Los_Angeles", { firstName: "Today" }, 1000);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runWebhook(createTzaUpdate({ messageId: 106 }));
		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		expect(text).toBe(
			[
				"2026-07-28 · UTC+14 · 13:30",
				"Pacific/Kiritimati：Tomorrow",
				"",
				"2026-07-27 · UTC-7 · 16:30",
				"America/Los_Angeles：Today",
			].join("\n"),
		);
	});

	it("无效时区不会中断其他成员的聚合", async () => {
		vi.setSystemTime(new Date("2026-07-27T13:30:00.000Z"));
		const chatId = "42";
		await registerSeenMember(chatId, "1401", "Asia/Shanghai", { firstName: "Alice" }, 2000);
		await registerSeenMember(chatId, "1402", "Mars/Base", { firstName: "Broken" }, 1000);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal("fetch", outboundFetch);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runWebhook(createTzaUpdate({ messageId: 107 }));
		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, "text");

		expect(text).toContain("Asia/Shanghai：Alice");
		expect(text).toContain("无效时区: Mars/Base：Broken");
		expect(text).not.toContain("共 ");
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
		const visibleCount = text?.match(/LongName_\d{3}/gu)?.length ?? 0;
		expect(visibleCount + hiddenCount).toBe(140);
		expect(text).not.toContain("共 ");

		const lines = text?.split("\n") ?? [];
		for (const [index, line] of lines.entries()) {
			if (/^\d{4}-\d{2}-\d{2} · UTC[+-]/u.test(line)) {
				expect(lines[index + 1]).toMatch(/^[A-Za-z_]+\//u);
			}
		}
	});
});
