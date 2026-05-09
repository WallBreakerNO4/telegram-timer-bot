import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { AI_MODEL, AI_TIMEOUT_MS, LOCALE } from '../config';
import { getUserTimezone, initSchema, listRegisteredSeenUsers, markSeen } from '../db';
import { MSG_NEED_INIT, MSG_PRIVATE_OR_GROUP_ONLY, MSG_TZM_LOW_CONFIDENCE, MSG_TZM_PARSE_FAILURE, MSG_TZM_SINGLE_POINT_ONLY, MSG_TZM_USAGE } from '../messages';
import { type TelegramApiCompat } from '../telegram_api';
import { getDisplayName, getUserProfileFromMessageUser } from '../telegram_profiles';
import { buildTzmMessage } from '../telegram_text';
import { formatLocalTime, formatUtcOffset } from '../time_format';
import {
  type AiCompat,
  isPeriodicExpression,
  parseTzmAiResponse,
  type TzmParseResult,
  runWithTimeout,
  TZM_SYSTEM_PROMPT,
} from '../tzm_ai';

const SPLIT_REGEX = /\s+/u;
const HOUR_CYCLE = 'h23' as const;

const TZM_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    isoTimestamp: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assumptions: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
  required: ['ok', 'isoTimestamp', 'confidence', 'assumptions', 'error'],
  additionalProperties: false,
} as const;

function parseCommandExpression(text: string | undefined): string {
  if (!text) {
    return '';
  }

  const tokens = text.trim().split(SPLIT_REGEX);
  if (tokens.length <= 1) {
    return '';
  }

  return tokens.slice(1).join(' ').trim();
}

function getTelegramMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const record = message as Record<string, unknown>;
  const text = record.text;
  if (typeof text === 'string') {
    return text;
  }

  const caption = record.caption;
  if (typeof caption === 'string') {
    return caption;
  }

  return '';
}

type DateTimeParts = { date: string; time: string };

function formatDateTimePartsInTimeZone(timeZone: string, date: Date): { ok: true; value: DateTimeParts } | { ok: false } {
  try {
    const formatter = new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: HOUR_CYCLE,
    });

    const parts = formatter.formatToParts(date);
    const year = parts.find((item) => item.type === 'year')?.value;
    const month = parts.find((item) => item.type === 'month')?.value;
    const day = parts.find((item) => item.type === 'day')?.value;
    const hour = parts.find((item) => item.type === 'hour')?.value;
    const minute = parts.find((item) => item.type === 'minute')?.value;
    const second = parts.find((item) => item.type === 'second')?.value;

    if (!year || !month || !day || !hour || !minute || !second) {
      return { ok: false };
    }

    return {
      ok: true,
      value: {
        date: `${year}-${month}-${day}`,
        time: `${hour}:${minute}:${second}`,
      },
    };
  } catch {
    return { ok: false };
  }
}

export function registerTzmHandler(bot: TelegramBot, env: Env): void {
  bot.on('tzm', async (ctx: TelegramExecutionContext) => {
    const message = ctx.update.message;
    if (!message?.chat?.id) {
      return new Response('ok');
    }

    const chatId = String(message.chat.id);
    const api = ctx.api as unknown as TelegramApiCompat;
    const chatType = message.chat.type;
    const isGroupChat = chatType === 'group' || chatType === 'supergroup';
    const isPrivateChat = chatType === 'private';
    const replyToMessageId = message.reply_to_message?.message_id ?? message.message_id;
    if (!isGroupChat && !isPrivateChat) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_PRIVATE_OR_GROUP_ONLY,
        parse_mode: '',
      });
      return new Response('ok');
    }

    const commandExpression = parseCommandExpression(message.text);
    const repliedExpression = getTelegramMessageText(message.reply_to_message).trim();
    const expression = commandExpression || repliedExpression;
    if (!expression) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_TZM_USAGE,
        parse_mode: '',
      });
      return new Response('ok');
    }

    if (isPeriodicExpression(expression)) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_TZM_SINGLE_POINT_ONLY,
        parse_mode: '',
      });
      return new Response('ok');
    }

    await initSchema(env);

    const requester = getUserProfileFromMessageUser(message.from);
    if (!requester) {
      return new Response('ok');
    }

    const requesterTimezone = await getUserTimezone(env, requester.userId);
    if (!requesterTimezone) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_NEED_INIT,
        parse_mode: '',
      });
      return new Response('ok');
    }

    if (isGroupChat) {
      await markSeen(env, chatId, requester);
      const replyTarget = getUserProfileFromMessageUser(message.reply_to_message?.from);
      if (replyTarget) {
        await markSeen(env, chatId, replyTarget);
      }
    }

    const shouldParseRepliedMessage = !commandExpression && Boolean(repliedExpression);
    let parserTimezone = requesterTimezone;
    if (shouldParseRepliedMessage) {
      const replyTarget = getUserProfileFromMessageUser(message.reply_to_message?.from);
      if (replyTarget) {
        const replyTargetTimezone = await getUserTimezone(env, replyTarget.userId);
        if (replyTargetTimezone) {
          parserTimezone = replyTargetTimezone;
        }
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const nowInRequesterTimezone = formatDateTimePartsInTimeZone(parserTimezone, now);
    const nowUtcOffset = formatUtcOffset(parserTimezone, now);

    const ai = (env as Env & { AI?: AiCompat }).AI;
    if (!ai) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_TZM_PARSE_FAILURE,
        parse_mode: '',
      });
      return new Response('ok');
    }

    let parsed: TzmParseResult;
    try {
      const aiResult = await runWithTimeout(
        ai.run(AI_MODEL, {
          messages: [
            {
              role: 'system',
              content: TZM_SYSTEM_PROMPT,
            },
             {
               role: 'user',
               content: JSON.stringify({
                 expression,
                 requesterTimezone: parserTimezone,
                 currentTimeUtc: nowIso,
                 currentDateInRequesterTimezone: nowInRequesterTimezone.ok ? nowInRequesterTimezone.value.date : undefined,
                 currentTimeInRequesterTimezone: nowInRequesterTimezone.ok
                   ? `${nowInRequesterTimezone.value.date}T${nowInRequesterTimezone.value.time}`
                   : undefined,
                 currentUtcOffsetInRequesterTimezone: nowUtcOffset.ok ? nowUtcOffset.value : undefined,
               }),
             },
           ],
          response_format: {
            type: 'json_schema',
            json_schema: TZM_JSON_SCHEMA,
          },
        }),
        AI_TIMEOUT_MS,
      );

      const parsedResult = parseTzmAiResponse(aiResult);
      if (!parsedResult.ok) {
        await api.sendMessage(ctx.bot.api.toString(), {
          chat_id: chatId,
          reply_to_message_id: replyToMessageId,
          text: MSG_TZM_PARSE_FAILURE,
          parse_mode: '',
        });
        return new Response('ok');
      }

      parsed = parsedResult.value;
    } catch {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_TZM_PARSE_FAILURE,
        parse_mode: '',
      });
      return new Response('ok');
    }

    if (!parsed.ok) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_TZM_PARSE_FAILURE,
        parse_mode: '',
      });
      return new Response('ok');
    }

    const targetDate = new Date(parsed.isoTimestamp);
    if (Number.isNaN(targetDate.getTime())) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: replyToMessageId,
        text: MSG_TZM_PARSE_FAILURE,
        parse_mode: '',
      });
      return new Response('ok');
    }

    const assumptionSuffix = parsed.assumptions.length > 0 ? `（假设：${parsed.assumptions.join('；')}）` : '';
    const confidenceSuffix = parsed.confidence === 'low' ? MSG_TZM_LOW_CONFIDENCE : '';
    const header = `解析为：${parsed.isoTimestamp} (${parserTimezone})${assumptionSuffix}${confidenceSuffix}`;

    let lines: string[];
    if (isGroupChat) {
      const users = await listRegisteredSeenUsers(env, chatId);
      lines = users.map((user) => {
        const localTime = formatLocalTime(user.timezone, targetDate);
        const displayName = getDisplayName(user);
        if (!localTime.ok) {
          return `${displayName}: ${localTime.error}`;
        }
        const utcOffset = formatUtcOffset(user.timezone, targetDate);
        if (!utcOffset.ok) {
          return `${displayName}: ${utcOffset.error}`;
        }
        return `${utcOffset.value} (${localTime.value}) | ${displayName}`;
      });
    } else {
      const localTime = formatLocalTime(requesterTimezone, targetDate);
      if (!localTime.ok) {
        lines = [localTime.error];
      } else {
        const utcOffset = formatUtcOffset(requesterTimezone, targetDate);
        if (!utcOffset.ok) {
          lines = [utcOffset.error];
        } else {
          lines = [`${utcOffset.value} (${localTime.value}) | ${getDisplayName(requester)}`];
        }
      }
    }

    const text = buildTzmMessage(header, lines);

    await api.sendMessage(ctx.bot.api.toString(), {
      chat_id: chatId,
      reply_to_message_id: replyToMessageId,
      text,
      parse_mode: '',
    });

    return new Response('ok');
  });
}
