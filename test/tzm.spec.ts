import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initSchema, markSeen, upsertUserTimezone, type UserProfile } from '../src/db';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = '123456:test_token';
const TEST_BOT_USERNAME = 'WallBreakerNO4_Timer_bot';
const TEST_OPENROUTER_API_KEY = 'test-openrouter-key';
const TEST_OPENROUTER_MODEL = 'test/structured-output-model';
type OutboundFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function createTelegramOkResponse(): Response {
	return new Response(JSON.stringify({ ok: true, result: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function createOpenRouterResponse(result: { timestamp: string; timezone: string }): Response {
	return new Response(JSON.stringify({
		id: 'gen-test',
		object: 'chat.completion',
		created: 0,
		model: TEST_OPENROUTER_MODEL,
		choices: [
			{
				index: 0,
				finish_reason: 'stop',
				logprobs: null,
				message: {
					role: 'assistant',
					content: JSON.stringify(result),
					refusal: null,
				},
			},
		],
	}), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function createOutboundFetch(
	openRouterResponse: () => Response = () => createOpenRouterResponse({ timestamp: '2026-02-10T17:00:00', timezone: 'UTC+8' }),
) {
	return vi.fn<OutboundFetch>(async (input) => {
		const url = input instanceof Request ? input.url : String(input);
		return new URL(url).hostname === 'openrouter.ai' ? openRouterResponse() : createTelegramOkResponse();
	});
}

function findOutboundCall(
	outboundFetch: ReturnType<typeof createOutboundFetch>,
	hostname: string,
): [RequestInfo | URL, RequestInit?] {
	const call = outboundFetch.mock.calls.find(([input]) => {
		const url = input instanceof Request ? input.url : String(input);
		return new URL(url).hostname === hostname;
	});
	if (!call) {
		throw new Error(`Missing outbound request to ${hostname}`);
	}
	return call;
}

async function readJsonBody(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Record<string, unknown>> {
	const bodyText = input instanceof Request ? await input.clone().text() : typeof init?.body === 'string' ? init.body : '';
	const parsed = JSON.parse(bodyText) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Expected JSON object request body');
	}
	return parsed as Record<string, unknown>;
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
	const commandLength = text.startsWith('/') ? (text.split(/\s/u)[0]?.length ?? 0) : 0;

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
			entities: commandLength > 0 ? [{ type: 'bot_command', offset: 0, length: commandLength }] : undefined,
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

async function runWebhook(
	update: Record<string, unknown>,
	openRouterConfig?: { apiKey?: string; model?: string },
): Promise<Response> {
	const request = createWebhookRequest(update);
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		request,
		{
			...env,
			SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN,
			TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME,
			OPENROUTER_API_KEY: openRouterConfig?.apiKey ?? TEST_OPENROUTER_API_KEY,
			OPENROUTER_MODEL: openRouterConfig?.model ?? TEST_OPENROUTER_MODEL,
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
			return value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : String(value);
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
			return value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : String(value);
		} catch {
			return new URLSearchParams(initBody).get(key);
		}
	}

	return null;
}

async function readReplyMessageId(input: RequestInfo | URL, init: RequestInit | undefined): Promise<string | null> {
	const raw = await readOutboundParam(input, init, 'reply_parameters');
	if (!raw) return null;

	const replyParameters = JSON.parse(raw) as { message_id?: number };
	return replyParameters.message_id === undefined ? null : String(replyParameters.message_id);
}

async function readShareButton(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<{ text: string; callback_data: string } | null> {
	const raw = await readOutboundParam(input, init, 'reply_markup');
	if (!raw) return null;

	const markup = JSON.parse(raw) as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> };
	return markup.inline_keyboard?.[0]?.[0] ?? null;
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-01-02T03:04:00.000Z'));

	await initSchema(env);
	await env.DB.prepare('DELETE FROM chat_users').run();
	await env.DB.prepare('DELETE FROM users').run();
	await env.DB.prepare('DELETE FROM ephemeral_shares').run();
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
		const outboundFetch = createOutboundFetch();
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'private', senderId: 1001, messageId: 101 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(2);

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readReplyMessageId(input, init);
		const receiverUserId = await readOutboundParam(input, init, 'receiver_user_id');
		expect(text).not.toBeNull();
		const lines = String(text ?? '').split('\n');
		expect(lines[0]).toMatch(/^解析为：/);

		expect(targetDate.toISOString()).toBe('2026-02-10T09:00:00.000Z');
		expect(lines.slice(1).join('\n')).toBe(
			['', '2026-02-10 · UTC+8 · 17:00', 'Asia/Shanghai：sender'].join('\n'),
		);
		expect(replyTo).toBe('101');
		expect(receiverUserId).toBeNull();
	});

	it('群聊中带 bot username 的定向命令会进入 /tzm handler', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		const outboundFetch = createOutboundFetch(() =>
			createOpenRouterResponse({ timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8' }),
		);
		vi.stubGlobal('fetch', outboundFetch);

		const response = await runWebhook(
			createTzmUpdate({
				chatType: 'group',
				senderId: 1001,
				messageId: 121,
				text: `/tzm@${TEST_BOT_USERNAME} 下午五点`,
			}),
		);

		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(2);
	});

	it('群聊但请求者未登记时区时提示请私聊初始化', async () => {
		const outboundFetch = createOutboundFetch();
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', senderId: 77, messageId: 102 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const text = await readOutboundParam(input, init, 'text');
		const replyTo = await readReplyMessageId(input, init);
		const receiverUserId = await readOutboundParam(input, init, 'receiver_user_id');
		const shareButton = await readShareButton(input, init);
		expect(text).toBe('请私聊 bot 用 /start 初始化');
		expect(replyTo).toBe('102');
		expect(receiverUserId).toBe('77');
		expect(shareButton).toBeNull();
	});

	it.each([
		['OPENROUTER_API_KEY', { apiKey: '' }, 'Missing OPENROUTER_API_KEY'],
		['OPENROUTER_MODEL', { model: '' }, 'Missing OPENROUTER_MODEL'],
	] as const)('缺少 %s 时直接失败且不发起外部请求', async (_name, config, errorMessage) => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		const outboundFetch = createOutboundFetch();
		vi.stubGlobal('fetch', outboundFetch);

		await expect(runWebhook(createTzmUpdate({ chatType: 'group', senderId: 1001, messageId: 123 }), config)).rejects.toThrow(errorMessage);
		expect(outboundFetch).not.toHaveBeenCalled();
	});

	it('reply /tzm 时解析被回复消息，并优先使用被回复用户的时区', async () => {
		await upsertUserTimezone(env, createProfile('2002', { firstName: 'Bob' }), 'Europe/Dublin');
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		const outboundFetch = createOutboundFetch();
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
		expect(outboundFetch).toHaveBeenCalledTimes(2);

		const [openRouterInput, openRouterInit] = findOutboundCall(outboundFetch, 'openrouter.ai');
		const aiPayload = await readJsonBody(openRouterInput, openRouterInit);
		const messages = aiPayload.messages as Array<{ role: string; content: string }>;
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

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const replyTo = await readReplyMessageId(input, init);
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

		const outboundFetch = createOutboundFetch();
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 103, senderId: 1001 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(2);

		const [openRouterInput, openRouterInit] = findOutboundCall(outboundFetch, 'openrouter.ai');
		const aiPayload = await readJsonBody(openRouterInput, openRouterInit);
		expect(aiPayload.model).toBe(TEST_OPENROUTER_MODEL);
		expect(aiPayload.tools).toBeUndefined();
		expect(aiPayload.tool_choice).toBeUndefined();
		expect(aiPayload.reasoning_effort).toBeUndefined();
		expect(aiPayload.max_completion_tokens).toBeUndefined();
		expect(aiPayload.max_tokens).toBe(384);
		expect(aiPayload.temperature).toBe(0);
		expect(aiPayload.provider).toEqual({ require_parameters: true, allow_fallbacks: false });
		expect(aiPayload.response_format).toEqual(
			expect.objectContaining({
				type: 'json_schema',
				json_schema: expect.objectContaining({
					name: 'tzm_parse_result',
					strict: true,
					schema: expect.objectContaining({ additionalProperties: false }),
				}),
			}),
		);
		const openRouterRequest = openRouterInput instanceof Request ? openRouterInput : new Request(String(openRouterInput), openRouterInit);
		expect(openRouterRequest.headers.get('authorization')).toBe(`Bearer ${TEST_OPENROUTER_API_KEY}`);

		const messages = aiPayload.messages as Array<{ role: string; content: string }>;
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('system');
		expect(typeof messages[0]?.content).toBe('string');
		expect(messages[0]?.content).not.toContain('resolve_time');
		expect(messages[0]?.content).toContain('当地墙上时间');
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

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const text = await readOutboundParam(input, init, 'text');
		const receiverUserId = await readOutboundParam(input, init, 'receiver_user_id');
		const shareButton = await readShareButton(input, init);
		expect(text).not.toBeNull();

		const lines = String(text ?? '').split('\n');
		expect(lines[0]).toMatch(/^解析为：/);

		expect(targetDate.toISOString()).toBe('2026-02-10T09:00:00.000Z');
		expect(lines.slice(1).join('\n')).toBe(
			[
				'',
				'2026-02-10 · UTC+8 · 17:00',
				'Asia/Shanghai：Alice Li',
				'',
				'2026-02-10 · UTC+0 · 09:00',
				'Europe/Dublin：@bob_u',
			].join('\n'),
		);
		expect(receiverUserId).toBe('1001');
		expect(shareButton).toEqual({ text: '分享到群聊', callback_data: expect.stringMatching(/^s\|/) });

		const shareRows = await env.DB.prepare(
			'SELECT chat_id, receiver_user_id, text FROM ephemeral_shares',
		).all<{ chat_id: string; receiver_user_id: string; text: string }>();
		expect(shareRows.results ?? []).toHaveLength(1);
		expect(shareRows.results?.[0]).toMatchObject({ chat_id: '42', receiver_user_id: '1001' });
	});

	it('按解析时刻的实际当地时间聚合，并应用夏令时偏移', async () => {
		const chatId = '42';
		const members = [
			{ id: '1001', name: 'Alice', timezone: 'Asia/Shanghai' },
			{ id: '1002', name: 'Bob', timezone: 'Asia/Singapore' },
			{ id: '1003', name: 'Dave', timezone: 'Europe/London' },
		] as const;
		for (const [index, member] of members.entries()) {
			const profile = createProfile(member.id, { firstName: member.name });
			await upsertUserTimezone(env, profile, member.timezone);
			await markSeen(env, chatId, profile, 1000 + index);
		}

		const outboundFetch = createOutboundFetch(() =>
			createOpenRouterResponse({ timestamp: '2026-07-27T21:30:00', timezone: 'UTC+8' }),
		);
		vi.stubGlobal('fetch', outboundFetch);

		await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 122, senderId: 1001 }));

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const text = await readOutboundParam(input, init, 'text');
		expect(text).toContain(
			[
				'2026-07-27 · UTC+8 · 21:30',
				'Asia/Shanghai：Alice',
				'Asia/Singapore：Bob',
				'',
				'2026-07-27 · UTC+1 · 14:30',
				'Europe/London：Dave',
			].join('\n'),
		);
	});

	it('给 AI 提供请求者时区的当前日期，避免 UTC 日期导致“明天”偏移', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		vi.setSystemTime(new Date('2026-02-09T16:30:00.000Z'));

		const outboundFetch = createOutboundFetch(() =>
			createOpenRouterResponse({ timestamp: '2026-02-11T11:00:00', timezone: 'UTC+8' }),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 120, senderId: 1001, text: '/tzm 明天中午11点' }));
		expect(response.status).toBe(200);

		const [openRouterInput, openRouterInit] = findOutboundCall(outboundFetch, 'openrouter.ai');
		const aiPayload = await readJsonBody(openRouterInput, openRouterInit);
		const messages = aiPayload.messages as Array<{ role: string; content: string }>;
		const prompt = JSON.parse(messages[1]?.content ?? '{}') as {
			currentTimeUtc?: string;
			user?: { name?: string; username?: string | null; timezone?: string; localTime?: string };
		};

		expect(prompt.currentTimeUtc).toBe('2026-02-09T16:30:00.000Z');
		expect(prompt.user?.timezone).toBe('Asia/Shanghai');
		expect(prompt.user?.localTime).toBe('2026-02-10T00:30:00+08:00');
	});

	it('AI 返回空 timestamp/timezone 时直接抛错', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const outboundFetch = createOutboundFetch(() =>
			createOpenRouterResponse({ timestamp: '', timezone: '' }),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		await expect(runWebhook(createTzmUpdate({ chatType: 'group', messageId: 104, senderId: 1001 }))).rejects.toThrow(
			'OpenRouter could not resolve the expression to a single timestamp',
		);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		findOutboundCall(outboundFetch, 'openrouter.ai');
	});

	it('OpenRouter 返回错误时保留原始错误且不重试', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');
		await markSeen(env, '42', createProfile('1001', { firstName: 'Alice' }), 1000);

		const outboundFetch = createOutboundFetch(
			() =>
				new Response(JSON.stringify({ error: { code: 503, message: 'OpenRouter unavailable' } }), {
					status: 503,
					headers: { 'content-type': 'application/json' },
				}),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		await expect(runWebhook(createTzmUpdate({ chatType: 'group', messageId: 105, senderId: 1001 }))).rejects.toThrow(
			'OpenRouter unavailable',
		);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		findOutboundCall(outboundFetch, 'openrouter.ai');
	});

	it('周期表达直接提示仅支持单次时间点', async () => {
		await upsertUserTimezone(env, createProfile('1001', { firstName: 'Alice' }), 'Asia/Shanghai');

		const outboundFetch = createOutboundFetch();
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'group', messageId: 106, senderId: 1001, text: '/tzm 每周一' }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const text = await readOutboundParam(input, init, 'text');
		const receiverUserId = await readOutboundParam(input, init, 'receiver_user_id');
		const shareButton = await readShareButton(input, init);
		expect(text).toBe('仅支持单次时间点');
		expect(receiverUserId).toBe('1001');
		expect(shareButton).toBeNull();
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

		const outboundFetch = createOutboundFetch(() =>
			createOpenRouterResponse({ timestamp: '2026-02-10T09:00:00', timezone: 'UTC+8' }),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const response = await runWebhook(createTzmUpdate({ chatType: 'supergroup', messageId: 109, senderId: 1001 }));
		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(2);

		const [input, init] = findOutboundCall(outboundFetch, 'api.telegram.org');
		const text = String((await readOutboundParam(input, init, 'text')) ?? '');

		expect(text.length).toBeLessThanOrEqual(4096);
		expect(text.split('\n')[0]?.startsWith('解析为：')).toBe(true);
		expect(text).toContain('（已截断，剩余 ');
		expect(text).toContain(' 人未显示）');

		const hiddenCount = Number(text.match(/剩余\s+(\d+)\s+人未显示/u)?.[1] ?? '0');
		expect(hiddenCount).toBeGreaterThan(0);
	});
});
