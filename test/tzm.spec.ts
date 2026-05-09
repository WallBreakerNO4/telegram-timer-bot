import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_MODEL } from '../src/config';
import { initSchema, markSeen, upsertUserTimezone, type UserProfile } from '../src/db';
import { formatLocalTime, formatUtcOffset } from '../src/time_format';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = '123456:test_token';
const TEST_BOT_USERNAME = 'WallBreakerNO4_Timer_bot';

function createTelegramOkResponse(): Response {
	return new Response(JSON.stringify({ ok: true, result: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function createWebhookRequest(update: Record<string, unknown>) {
	return new IncomingRequest(`https://example.com/${TEST_TOKEN}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(update),
	});
}

function createTzmUpdate(params?: {
	chatType?: 'private' | 'group' | 'supergroup';
	chatId?: number;
	senderId?: number;
	messageId?: number;
	text?: string;
	replyTo?: {
		senderId: number;
		messageId: number;
		text?: string;
	};
}): Record<string, unknown> {
	const { chatType = 'group', chatId = 42, senderId = 7, messageId = 10, text = '/tzm 明天下午五点', replyTo } = params ?? {};

	const replyToMessage =
		replyTo === undefined
			? undefined
			: {
				message_id: replyTo.messageId,
				date: 1700000000,
				text: replyTo.text ?? '',
				from: {
					id: replyTo.senderId,
					is_bot: false,
					first_name: 'reply_sender',
					username: 'reply_sender_u',
				},
			};

	return {
		update_id: 1,
		message: {
			message_id: messageId,
			date: 1700000000,
			text,
			chat: {
				id: chatId,
				type: chatType,
			},
			from: {
				id: senderId,
				is_bot: false,
				first_name: 'sender',
				username: 'sender_u',
			},
			reply_to_message: replyToMessage,
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

async function runWebhook(update: Record<string, unknown>, ai?: unknown): Promise<Response> {
	const request = createWebhookRequest(update);
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		request,
		{ ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN, TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME, AI: ai as unknown as Ai },
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
					.catch(() => '')
			: '';

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
	if (typeof initBody === 'string') {
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
	vi.setSystemTime(new Date('2026-01-02T03:04:00.000Z'));

	await initSchema(env);
	await env.DB.prepare('DELETE FROM chat_users').run();
	await env.DB.prepare('DELETE FROM users').run();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('/tzm', () => {
	it('私聊也能解析并返回请求者本地时间', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Sender' }), 'Asia/Shanghai');

		const targetIso = '2026-02-10T17:00:00+08:00';
		const targetDate = new Date(targetIso);
		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: true,
					isoTimestamp: targetIso,
					confidence: 'high',
					assumptions: [],
					error: '',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'private', senderId: 1001, messageId: 101 }), { run: aiRun });
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		expect(aiRun).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(text).not.toBeNull();
		const lines = String(text ?? '').split('\n');
		expect(lines[0]).toMatch(/^解析为：/);

		const local = formatLocalTime('Asia/Shanghai', targetDate);
		const offset = formatUtcOffset('Asia/Shanghai', targetDate);
		const expectedLine = local.ok && offset.ok ? `${offset.value} (${local.value}) | sender` : '';
		expect(lines.slice(1).join('\n')).toBe(expectedLine);
		expect(replyTo).toBe('101');
	});

	it('群聊但请求者未登记时区时提示请私聊初始化', async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', senderId: 77, messageId: 102 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(text).toBe('请私聊 bot 用 /start 初始化');
		expect(replyTo).toBe('102');
	});

	it('reply /tzm 时解析被回复消息，并优先使用被回复用户的时区', async () => {
		await upsertUserTimezone(env, createProfile('2002', { firstName: 'Bob' }), 'Europe/Dublin');
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: true,
					isoTimestamp: '2026-02-10T17:00:00+08:00',
					confidence: 'high',
					assumptions: [],
					error: '',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(
			createTzmUpdate({
				chatType: 'group',
				senderId: 2002,
				messageId: 111,
				text: '/tzm',
				replyTo: {
					senderId: 1001,
					messageId: 110,
					text: '明天下午五点我们一起来看比赛',
				},
			}),
			{ run: aiRun },
		);
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		expect(aiRun).toHaveBeenCalledTimes(1);

		const aiCall = aiRun.mock.calls[0];
		const aiPayload = (aiCall?.[1] ?? {}) as Record<string, unknown>;
		const messages = aiPayload.messages as Array<{ role: string; content: string }>;
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			expression?: string;
			requesterTimezone?: string;
			currentTimeUtc?: string;
			currentDateInRequesterTimezone?: string;
			currentTimeInRequesterTimezone?: string;
			currentUtcOffsetInRequesterTimezone?: string;
		};
		expect(prompt.expression).toBe('明天下午五点我们一起来看比赛');
		expect(prompt.requesterTimezone).toBe('Asia/Shanghai');

		const [input, init] = outboundFetch.mock.calls[0];
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(replyTo).toBe('110');
	});

	it('成功解析：首行回显解析为，后续按 /tza 行格式输出成员当地时间', async () => {
		const chatId = '42';
		await upsertUserTimezone(
			env,
			createProfile('1001', { username: 'alice_u', firstName: 'Alice', lastName: 'Li' }),
			'Asia/Shanghai',
		);
		await upsertUserTimezone(env, createProfile('1002', { username: 'bob_u' }), 'Europe/Dublin');

		await markSeen(env, chatId, createProfile('1001', { username: 'alice_u', firstName: 'Alice', lastName: 'Li' }), 1000);
		await markSeen(env, chatId, createProfile('1002', { username: 'bob_u' }), 2000);

		const targetIso = '2026-02-10T17:00:00+08:00';
		const targetDate = new Date(targetIso);

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
			response: {
				ok: true,
				isoTimestamp: targetIso,
				confidence: 'high',
				assumptions: [],
				error: '',
			},
		}),
		);
		const fakeAI = { run: aiRun };

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 103, senderId: 1001 }), fakeAI);
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		expect(aiRun).toHaveBeenCalledTimes(1);

		const aiCall = aiRun.mock.calls[0];
		const model = String(aiCall?.[0] ?? '');
		const aiPayload = (aiCall?.[1] ?? {}) as Record<string, unknown>;
		expect(model).toBe(AI_MODEL);
		expect(aiPayload.response_format).toMatchObject({ type: 'json_schema' });

		const messages = aiPayload.messages as Array<{ role: string; content: string }>;
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('system');
		expect(typeof messages[0]?.content).toBe('string');
		expect(messages[0]?.content).toContain('currentTimeUtc');
		expect(messages[1]?.role).toBe('user');
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			expression?: string;
			requesterTimezone?: string;
			currentTimeUtc?: string;
			currentDateInRequesterTimezone?: string;
			currentTimeInRequesterTimezone?: string;
			currentUtcOffsetInRequesterTimezone?: string;
			users?: unknown;
		};
		expect(prompt.expression).toBe('明天下午五点');
		expect(prompt.requesterTimezone).toBe('Asia/Shanghai');
		expect(typeof prompt.currentTimeUtc).toBe('string');
		expect(prompt.users).toBeUndefined();

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		expect(text).not.toBeNull();

		const lines = String(text ?? '').split('\n');
		expect(lines[0]).toMatch(/^解析为：/);

		const dublinLocal = formatLocalTime('Europe/Dublin', targetDate);
		const dublinOffset = formatUtcOffset('Europe/Dublin', targetDate);
		const shLocal = formatLocalTime('Asia/Shanghai', targetDate);
		const shOffset = formatUtcOffset('Asia/Shanghai', targetDate);

		const expectedDublinLine =
			dublinLocal.ok && dublinOffset.ok ? `${dublinOffset.value} (${dublinLocal.value}) | @bob_u` : '';
		const expectedShanghaiLine =
			shLocal.ok && shOffset.ok ? `${shOffset.value} (${shLocal.value}) | Alice Li` : '';

		expect(lines.slice(1).join('\n')).toBe([expectedShanghaiLine, expectedDublinLine].join('\n'));
	});

	it('给 AI 提供请求者时区的当前日期，避免 UTC 日期导致“明天”偏移', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		vi.setSystemTime(new Date('2026-02-09T16:30:00.000Z'));

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: true,
					isoTimestamp: '2026-02-11T11:00:00+08:00',
					confidence: 'high',
					assumptions: [],
					error: '',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 120, senderId: 1001, text: '/tzm 明天中午11点' }), {
			run: aiRun,
		});
		expect(response.status).toBe(200);
		expect(aiRun).toHaveBeenCalledTimes(1);

		const aiCall = aiRun.mock.calls[0];
		const aiPayload = (aiCall?.[1] ?? {}) as Record<string, unknown>;
		const messages = aiPayload.messages as Array<{ role: string; content: string }>;
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			currentTimeUtc?: string;
			currentDateInRequesterTimezone?: string;
			currentTimeInRequesterTimezone?: string;
			currentUtcOffsetInRequesterTimezone?: string;
		};

		expect(prompt.currentTimeUtc).toBe('2026-02-09T16:30:00.000Z');
		expect(prompt.currentDateInRequesterTimezone).toBe('2026-02-10');
		expect(prompt.currentTimeInRequesterTimezone).toBe('2026-02-10T00:30:00');
		expect(prompt.currentUtcOffsetInRequesterTimezone).toBe('UTC+8');
	});

	it('AI 返回 ok=false 时回复稳定错误文案', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: false,
					isoTimestamp: '',
					confidence: 'low',
					assumptions: [],
					error: 'ambiguous',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 104, senderId: 1001 }), { run: aiRun });
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(text).toBe('解析失败：请用更具体的表达，例如：/tzm 明天下午五点');
		expect(replyTo).toBe('104');
	});

	it('AI 抛错时回复稳定错误文案', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => {
				throw new Error("JSON Mode couldn't be met");
			},
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 105, senderId: 1001 }), { run: aiRun });
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(text).toBe('解析失败：请用更具体的表达，例如：/tzm 明天下午五点');
		expect(replyTo).toBe('105');
	});

	it('周期表达直接提示仅支持单次时间点', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 106, senderId: 1001, text: '/tzm 每周一' }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		expect(text).toBe('仅支持单次时间点');
	});

	it('低置信度时在 header 追加低置信度标记', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: true,
					isoTimestamp: '2026-02-10T08:00:00+08:00',
					confidence: 'low',
					assumptions: [],
					error: '',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 107, senderId: 1001 }), { run: aiRun });
		expect(response.status).toBe(200);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = String((await readOutboundParam(input, init, 'text')) ?? '');
		expect(text.split('\n')[0]).toContain('（低置信度）');
	});

	it('header 追加 assumptions（含仅时间与仅日期假设）', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: true,
					isoTimestamp: '2026-02-10T09:00:00+08:00',
					confidence: 'medium',
					assumptions: ['仅提供时间，按最近未来一次', '仅提供日期，默认 09:00'],
					error: '',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 108, senderId: 1001 }), { run: aiRun });
		expect(response.status).toBe(200);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = String((await readOutboundParam(input, init, 'text')) ?? '');
		expect(text.split('\n')[0]).toContain('（假设：仅提供时间，按最近未来一次；仅提供日期，默认 09:00）');
	});

	it('超长消息时保留 header 首行并追加截断尾注，且总长度不超过 4096', async () => {
		const chatId = '42';
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Requester' }), 'Asia/Shanghai');
		for (let index = 1; index <= 140; index += 1) {
			const userId = String(3000 + index);
			const longName = `LongName_${index.toString().padStart(3, '0')}_${'x'.repeat(60)}`;
			const profile = createProfile(userId, {
				firstName: longName,
				lastName: 'Tail',
				username: `user_${index}`,
			});

			await upsertUserTimezone(env, profile, 'Asia/Shanghai');
			await markSeen(env, chatId, profile, 100000 + index);
		}

		const aiRun = vi.fn<(model: string, request: Record<string, unknown>) => Promise<{ response: Record<string, unknown> }>>(
			async () => ({
				response: {
					ok: true,
					isoTimestamp: '2026-02-10T09:00:00+08:00',
					confidence: 'medium',
					assumptions: ['仅提供日期，默认 09:00'],
					error: '',
				},
			}),
		);

		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'supergroup', messageId: 109, senderId: 1001 }), { run: aiRun });
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = String((await readOutboundParam(input, init, 'text')) ?? '');

		expect(text.length).toBeLessThanOrEqual(4096);
		expect(text.split('\n')[0]?.startsWith('解析为：')).toBe(true);
		expect(text).toContain('（已截断，剩余 ');
		expect(text).toContain(' 人未显示）');

		const hiddenCount = Number(text.match(/剩余\s+(\d+)\s+人未显示/u)?.[1] ?? '0');
		expect(hiddenCount).toBeGreaterThan(0);
	});
});
