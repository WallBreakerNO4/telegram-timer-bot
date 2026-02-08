import TelegramBot, { TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';
import { decodeCallbackData } from './callback_data';
import {
	getUserTimezone,
	initSchema,
	listRegisteredSeenUsers,
	markSeen,
	upsertUserTimezone,
	type SeenRegisteredUser,
	type UserProfile,
} from './db';
import {
	buildRegionSelectorMarkup,
	buildTimezonePageView,
	DEFAULT_TIMEZONE_PAGE_SIZE,
} from './handlers/timezone_keyboard';
import { formatLocalTime } from './time_format';
import { getSupportedTimezones } from './timezones';

type TelegramHandler = (ctx: TelegramExecutionContext) => Promise<Response>;

const placeholderHandler: TelegramHandler = async () => new Response('ok');
const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

const TELEGRAM_WEBHOOK_ALLOWED_UPDATES = [
	'message',
	'callback_query',
	'inline_query',
	'business_message',
	'business_connection',
] as const;

interface TelegramCallbackAnswerPayload {
	callback_query_id: string;
	text?: string;
}

interface TelegramApiCompat {
	answerCallbackQuery?: (botApi: string, data: TelegramCallbackAnswerPayload) => Promise<Response>;
	answerCallback?: (botApi: string, data: TelegramCallbackAnswerPayload) => Promise<Response>;
	sendMessage: (botApi: string, data: Record<string, unknown>) => Promise<Response>;
	editMessageText: (botApi: string, data: Record<string, unknown>) => Promise<Response>;
}

interface TelegramMessageUserCompat {
	id: number | string;
	username?: string;
	first_name?: string;
	last_name?: string;
}

function getUserProfileFromCallback(ctx: TelegramExecutionContext): UserProfile | null {
	const from = ctx.update.callback_query?.from;
	if (!from?.id) {
		return null;
	}

	return {
		userId: String(from.id),
		username: from.username ?? null,
		firstName: from.first_name ?? null,
		lastName: null,
	};
}

function getUserProfileFromMessageUser(
	from: TelegramMessageUserCompat | undefined,
): UserProfile | null {
	if (!from?.id) {
		return null;
	}

	return {
		userId: String(from.id),
		username: from.username ?? null,
		firstName: from.first_name ?? null,
		lastName: from.last_name ?? null,
	};
}

function getDisplayName(user: SeenRegisteredUser): string {
	const nickname = [user.firstName, user.lastName]
		.filter((value): value is string => Boolean(value && value.trim()))
		.join(' ')
		.trim();

	if (nickname) {
		return nickname;
	}

	if (user.username?.trim()) {
		return `@${user.username.trim()}`;
	}

	return user.userId;
}

function buildTzaMessage(lines: string[]): string {
	if (lines.length === 0) {
		return '本群暂无已登记且被识别的成员';
	}

	const fullMessage = lines.join('\n');
	if (fullMessage.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
		return fullMessage;
	}

	for (let visibleCount = lines.length - 1; visibleCount >= 0; visibleCount -= 1) {
		const hiddenCount = lines.length - visibleCount;
		const suffix = `（已截断，剩余 ${hiddenCount} 人未显示）`;
		const visibleText = visibleCount > 0 ? lines.slice(0, visibleCount).join('\n') : '';
		const candidate = visibleText ? `${visibleText}\n${suffix}` : suffix;

		if (candidate.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
			return candidate;
		}
	}

	return '（已截断，剩余成员未显示）';
}

async function answerCallbackQuery(ctx: TelegramExecutionContext, callbackQueryId: string, text?: string): Promise<void> {
	const payload: TelegramCallbackAnswerPayload = {
		callback_query_id: callbackQueryId,
		...(text ? { text } : {}),
	};

	const api = ctx.api as unknown as TelegramApiCompat;
	if (typeof api.answerCallbackQuery === 'function') {
		await api.answerCallbackQuery(ctx.bot.api.toString(), payload);
		return;
	}

	if (typeof api.answerCallback === 'function') {
		await api.answerCallback(ctx.bot.api.toString(), payload);
	}
}

async function editMessageTextWithFallback(
	ctx: TelegramExecutionContext,
	chatId: string,
	messageId: number,
	text: string,
	replyMarkup: object,
): Promise<void> {
	const api = ctx.api as unknown as TelegramApiCompat;

	const response = await api.editMessageText(ctx.bot.api.toString(), {
		chat_id: chatId,
		message_id: messageId,
		text,
		reply_markup: replyMarkup,
	});

	const payload = await response
		.clone()
		.json()
		.catch(() => null) as { ok?: boolean } | null;

	if (!response.ok || payload?.ok === false) {
		await api.sendMessage(ctx.bot.api.toString(), {
			chat_id: chatId,
			reply_to_message_id: messageId,
			text,
			reply_markup: replyMarkup,
			parse_mode: '',
		});
	}
}

function createBot(token: string, env: Env): TelegramBot {
	const bot = new TelegramBot(token);
	const supportedTimezones = getSupportedTimezones();

	bot.on('start', async (ctx) => {
		const message = ctx.update.message;
		if (!message?.chat?.id) {
			return new Response('ok');
		}

		if (message.chat.type !== 'private') {
			return (await ctx.reply('请私聊我使用 /start')) ?? new Response('ok');
		}

		const markup = buildRegionSelectorMarkup(supportedTimezones);
		await (ctx.api as unknown as TelegramApiCompat).sendMessage(ctx.bot.api.toString(), {
			chat_id: String(message.chat.id),
			reply_to_message_id: message.message_id,
			text: '请选择区域',
			reply_markup: markup,
			parse_mode: '',
		});

		return new Response('ok');
	});

	bot.on('changetz', async (ctx) => {
		const message = ctx.update.message;
		if (!message?.chat?.id) {
			return new Response('ok');
		}

		if (message.chat.type !== 'private') {
			return (await ctx.reply('请私聊我使用 /start')) ?? new Response('ok');
		}

		const markup = buildRegionSelectorMarkup(supportedTimezones);
		await (ctx.api as unknown as TelegramApiCompat).sendMessage(ctx.bot.api.toString(), {
			chat_id: String(message.chat.id),
			reply_to_message_id: message.message_id,
			text: '请选择区域',
			reply_markup: markup,
			parse_mode: '',
		});

		return new Response('ok');
	});
	bot.on('tz', async (ctx) => {
		const message = ctx.update.message;
		if (!message?.chat?.id || !message?.from?.id) {
			return new Response('ok');
		}

		const chatId = String(message.chat.id);
		const requester = getUserProfileFromMessageUser(message.from);
		if (!requester) {
			return new Response('ok');
		}

		const replyTarget = getUserProfileFromMessageUser(message.reply_to_message?.from);
		const targetUserId = replyTarget?.userId ?? requester.userId;
		const replyToMessageId = message.reply_to_message?.message_id ?? message.message_id;

		await initSchema(env);

		if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
			await markSeen(env, chatId, requester);
			if (replyTarget) {
				await markSeen(env, chatId, replyTarget);
			}
		}

		const timezone = await getUserTimezone(env, targetUserId);
		const text = timezone
			? (() => {
				const localTime = formatLocalTime(timezone, new Date());
				return localTime.ok ? localTime.value : localTime.error;
			})()
			: '请私聊 bot 用 /start 初始化';

		await (ctx.api as unknown as TelegramApiCompat).sendMessage(ctx.bot.api.toString(), {
			chat_id: chatId,
			reply_to_message_id: replyToMessageId,
			text,
			parse_mode: '',
		});

		return new Response('ok');
	});
	bot.on('tza', async (ctx) => {
		const message = ctx.update.message;
		if (!message?.chat?.id) {
			return new Response('ok');
		}

		const chatId = String(message.chat.id);
		const api = ctx.api as unknown as TelegramApiCompat;

		if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') {
			await api.sendMessage(ctx.bot.api.toString(), {
				chat_id: chatId,
				reply_to_message_id: message.message_id,
				text: '仅群聊可用',
				parse_mode: '',
			});
			return new Response('ok');
		}

		await initSchema(env);
		const users = await listRegisteredSeenUsers(env, chatId);
		const lines = users.map((user) => {
			const localTime = formatLocalTime(user.timezone, new Date());
			const timeText = localTime.ok ? localTime.value : localTime.error;
			return `${getDisplayName(user)}: ${timeText}`;
		});
		const text = buildTzaMessage(lines);

		await api.sendMessage(ctx.bot.api.toString(), {
			chat_id: chatId,
			reply_to_message_id: message.message_id,
			text,
			parse_mode: '',
		});

		return new Response('ok');
	});
	bot.on(':callback', async (ctx) => {
		const callback = ctx.update.callback_query;
		if (!callback?.id) {
			return new Response('ok');
		}

		const callbackId = String(callback.id);
		const chatId = callback.message?.chat?.id ? String(callback.message.chat.id) : '';
		const messageId = callback.message?.message_id;

		if (!chatId || !messageId || !callback.data) {
			await answerCallbackQuery(ctx, callbackId, '消息已过期，请重新 /start');
			return new Response('ok');
		}

		const decoded = decodeCallbackData(callback.data, supportedTimezones);
		if (!decoded.ok) {
			await answerCallbackQuery(ctx, callbackId, '操作无效，请重新选择');
			return new Response('ok');
		}

		try {
			switch (decoded.value.action) {
				case 'r': {
					const pageView = buildTimezonePageView(
						supportedTimezones,
						decoded.value.region,
						1,
						DEFAULT_TIMEZONE_PAGE_SIZE,
					);
					await editMessageTextWithFallback(ctx, chatId, messageId, pageView.text, pageView.markup);
					await answerCallbackQuery(ctx, callbackId);
					return new Response('ok');
				}
				case 'p': {
					const pageView = buildTimezonePageView(
						supportedTimezones,
						decoded.value.region,
						decoded.value.page,
						decoded.value.pageSize,
					);
					await editMessageTextWithFallback(ctx, chatId, messageId, pageView.text, pageView.markup);
					await answerCallbackQuery(ctx, callbackId);
					return new Response('ok');
				}
				case 'b': {
					const markup = buildRegionSelectorMarkup(supportedTimezones);
					await editMessageTextWithFallback(ctx, chatId, messageId, '请选择区域', markup);
					await answerCallbackQuery(ctx, callbackId);
					return new Response('ok');
				}
				case 't': {
					const userProfile = getUserProfileFromCallback(ctx);
					if (!userProfile) {
						await answerCallbackQuery(ctx, callbackId, '用户信息缺失，请重试');
						return new Response('ok');
					}

					await initSchema(env);
					await upsertUserTimezone(env, userProfile, decoded.value.timezone);
					await editMessageTextWithFallback(
						ctx,
						chatId,
						messageId,
						`时区设置完成：${decoded.value.timezone}`,
						{ inline_keyboard: [] },
					);
					await answerCallbackQuery(ctx, callbackId, '时区已保存');
					return new Response('ok');
				}
			}
		} catch {
			await answerCallbackQuery(ctx, callbackId, '处理失败，请稍后重试');
		}

		return new Response('ok');
	});
	bot.on(':message', placeholderHandler);

	return bot;
}

async function setTelegramWebhook(token: string, request: Request): Promise<Response> {
	const apiBase = `https://api.telegram.org/bot${token}`;
	const url = new URL(`${apiBase}/setWebhook`);
	const webhookUrl = `${new URL(request.url).origin}/${token}`;
	const params = new URLSearchParams({
		url: webhookUrl,
		max_connections: '100',
		allowed_updates: JSON.stringify(TELEGRAM_WEBHOOK_ALLOWED_UPDATES),
		drop_pending_updates: 'true',
	});

	return fetch(`${url.toString()}?${params.toString()}`);
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		if (!env.SECRET_TELEGRAM_API_TOKEN) {
			return new Response('Missing telegram token', { status: 500 });
		}

		const token = env.SECRET_TELEGRAM_API_TOKEN;
		const url = new URL(request.url);
		if (`/${token}` !== url.pathname) {
			return new Response('Invalid token', { status: 404 });
		}

		if (request.method === 'GET' && url.searchParams.get('command') === 'set') {
			return setTelegramWebhook(token, request);
		}

		const bot = createBot(token, env);
		return bot.handle(request);
	},
} satisfies ExportedHandler<Env>;
