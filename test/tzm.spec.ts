import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPENAI_DEFAULT_BASE_URL, OPENAI_MODEL } from '../src/config';
import { initSchema, markSeen, upsertUserTimezone, type UserProfile } from '../src/db';
import { formatLocalTime, formatUtcOffset } from '../src/time_format';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = '123456:test_token';
const TEST_BOT_USERNAME = 'WallBreakerNO4_Timer_bot';
const TEST_API_KEY = 'sk-test-key';

function createTelegramOkResponse(): Response {
	return new Response(JSON.stringify({ ok: true, result: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function createOpenAIResponse(content: Record<string, unknown>): Response {
	return new Response(
		JSON.stringify({
			choices: [{ message: { content: JSON.stringify(content) } }],
		}),
		{
			status: 200,
			headers: { 'content-type': 'application/json' },
		},
	);
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

function createFetchMock(openaiResponse: Response | null, extraHandler?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) {
	return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));

			if (url.includes('api.telegram.org')) {
				return createTelegramOkResponse();
			}

			if (url.includes('/v1/chat/completions')) {
				if (extraHandler) {
					return extraHandler(input, init);
				}
				if (openaiResponse) {
					return openaiResponse;
				}
			}

			return createTelegramOkResponse();
		},
	);
}

async function runWebhook(update: Record<string, unknown>): Promise<Response> {
	const request = createWebhookRequest(update);
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		request,
		{
			...env,
			SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN,
			TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME,
			OPENAI_API_KEY: TEST_API_KEY,
			OPENAI_BASE_URL: OPENAI_DEFAULT_BASE_URL,
		},
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

		const targetDate = new Date('2026-02-10T17:00:00+08:00');
		const openAIResponse = createOpenAIResponse({ timestamp: '2026-02-10T17:00:00', timezone: 'UTC+8' });

		const outboundFetch = createFetchMock(openAIResponse);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'private', senderId: 1001, messageId: 101 }));
		expect(response.status).toBe(200);

		const [input, init] = outboundFetch.mock.calls[outboundFetch.mock.calls.length - 1];
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
		const outboundFetch = createFetchMock(null);
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

		const openAIResponse = createOpenAIResponse({ timestamp: '2026-02-10T17:00:00', timezone: 'UTC+8' });
		let capturedBody: Record<string, unknown> = {};

		const outboundFetch = createFetchMock(openAIResponse, async (input, init) => {
			const body = init?.body;
			if (typeof body === 'string') {
				capturedBody = JSON.parse(body) as Record<string, unknown>;
			}
			return openAIResponse;
		});
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
		);
		expect(response.status).toBe(200);

		expect(capturedBody.model).toBe(OPENAI_MODEL);
		const messages = capturedBody.messages as Array<{ role: string; content: string }>;
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			expression?: string;
			user?: { name?: string; username?: string | null; timezone?: string; localTime?: string };
			currentTimeUtc?: string;
			context?: Array<{ sender: string; text: string; time: string }>;
		};
		expect(prompt.expression).toBe('明天下午五点我们一起来看比赛');
		expect(prompt.user?.timezone).toBe('Asia/Shanghai');
		expect(prompt.context).toHaveLength(1);
		expect(prompt.context?.[0]?.sender).toBe('reply_sender');
		expect(prompt.context?.[0]?.text).toBe('明天下午五点我们一起来看比赛');
		expect(typeof prompt.context?.[0]?.time).toBe('string');

		const lastCall = outboundFetch.mock.calls[outboundFetch.mock.calls.length - 1];
		const [input, init] = lastCall;
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

		const targetDate = new Date('2026-02-10T17:00:00+08:00');
		const openAIResponse = createOpenAIResponse({ timestamp: '2026-02-10T17:00:00', timezone: 'UTC+8' });

		let capturedBody: Record<string, unknown> = {};
		const outboundFetch = createFetchMock(openAIResponse, async (input, init) => {
			const body = init?.body;
			if (typeof body === 'string') {
				capturedBody = JSON.parse(body) as Record<string, unknown>;
			}
			return openAIResponse;
		});
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 103, senderId: 1001 }));
		expect(response.status).toBe(200);

		expect(capturedBody.model).toBe(OPENAI_MODEL);
		expect(capturedBody.response_format).toMatchObject({ type: 'json_object' });

		const messages = capturedBody.messages as Array<{ role: string; content: string }>;
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('system');
		expect(typeof messages[0]?.content).toBe('string');
		expect(messages[0]?.content).toContain('currentTimeUtc');
		expect(messages[1]?.role).toBe('user');
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			expression?: string;
			user?: { name?: string; username?: string | null; timezone?: string; localTime?: string };
			currentTimeUtc?: string;
			context?: Array<{ sender: string; text: string; time: string }>;
		};
		expect(prompt.expression).toBe('明天下午五点');
		expect(prompt.user?.timezone).toBe('Asia/Shanghai');
		expect(typeof prompt.currentTimeUtc).toBe('string');
		expect(prompt.context).toEqual([]);

		const lastCall = outboundFetch.mock.calls[outboundFetch.mock.calls.length - 1];
		const [input, init] = lastCall;
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

	it('给 AI 提供请求者时区的当前日期，避免 UTC 日期导致"明天"偏移', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		vi.setSystemTime(new Date('2026-02-09T16:30:00.000Z'));

		const openAIResponse = createOpenAIResponse({ timestamp: '2026-02-11T11:00:00', timezone: 'UTC+8' });

		let capturedBody: Record<string, unknown> = {};
		const outboundFetch = createFetchMock(openAIResponse, async (input, init) => {
			const body = init?.body;
			if (typeof body === 'string') {
				capturedBody = JSON.parse(body) as Record<string, unknown>;
			}
			return openAIResponse;
		});
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 120, senderId: 1001, text: '/tzm 明天中午11点' }));
		expect(response.status).toBe(200);

		const messages = capturedBody.messages as Array<{ role: string; content: string }>;
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			currentTimeUtc?: string;
			user?: { name?: string; username?: string | null; timezone?: string; localTime?: string };
		};

		expect(prompt.currentTimeUtc).toBe('2026-02-09T16:30:00.000Z');
		expect(prompt.user?.timezone).toBe('Asia/Shanghai');
		expect(prompt.user?.localTime).toBe('2026-02-10T00:30:00+08:00');
	});

	it('AI 返回空 timestamp/timezone 时回复稳定错误文案', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const openAIResponse = createOpenAIResponse({ timestamp: '', timezone: '' });

		const outboundFetch = createFetchMock(openAIResponse);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 104, senderId: 1001 }));
		expect(response.status).toBe(200);

		const lastCall = outboundFetch.mock.calls[outboundFetch.mock.calls.length - 1];
		const [input, init] = lastCall;
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(text).toBe('解析失败：请用更具体的表达，例如：/tzm 明天下午五点');
		expect(replyTo).toBe('104');
	});

	it('AI API 返回非 200 时回复稳定错误文案', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const errorResponse = new Response(JSON.stringify({ error: { message: 'Service Unavailable' } }), {
			status: 503,
			headers: { 'content-type': 'application/json' },
		});

		const outboundFetch = createFetchMock(errorResponse);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 105, senderId: 1001 }));
		expect(response.status).toBe(200);

		const lastCall = outboundFetch.mock.calls[outboundFetch.mock.calls.length - 1];
		const [input, init] = lastCall;
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readOutboundParam(input, init, 'reply_to_message_id');
		expect(text).toBe('解析失败：请用更具体的表达，例如：/tzm 明天下午五点');
		expect(replyTo).toBe('105');
	});

	it('周期表达直接提示仅支持单次时间点', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		const outboundFetch = createFetchMock(null);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 106, senderId: 1001, text: '/tzm 每周一' }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = outboundFetch.mock.calls[0];
		const text = await readOutboundParam(input, init, 'text');
		expect(text).toBe('仅支持单次时间点');
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

		const openAIResponse = createOpenAIResponse({ timestamp: '2026-02-10T09:00:00', timezone: 'UTC+8' });

		const outboundFetch = createFetchMock(openAIResponse);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'supergroup', messageId: 109, senderId: 1001 }));
		expect(response.status).toBe(200);

		const lastCall = outboundFetch.mock.calls[outboundFetch.mock.calls.length - 1];
		const [input, init] = lastCall;
		const text = String((await readOutboundParam(input, init, 'text')) ?? '');

		expect(text.length).toBeLessThanOrEqual(4096);
		expect(text.split('\n')[0]?.startsWith('解析为：')).toBe(true);
		expect(text).toContain('（已截断，剩余 ');
		expect(text).toContain(' 人未显示）');

		const hiddenCount = Number(text.match(/剩余\s+(\d+)\s+人未显示/u)?.[1] ?? '0');
		expect(hiddenCount).toBeGreaterThan(0);
	});
});
