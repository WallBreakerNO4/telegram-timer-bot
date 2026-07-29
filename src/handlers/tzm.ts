import { type Bot, type Context } from 'grammy';

import { AI_MODEL, AI_TIMEOUT_MS, LOCALE } from '../config';
import { getUserTimezone, initSchema, listRegisteredSeenUsers, markSeen } from '../db';
import { MSG_NEED_INIT, MSG_PRIVATE_OR_GROUP_ONLY, MSG_TZM_SINGLE_POINT_ONLY, MSG_TZM_USAGE } from '../messages';
import { getDisplayName, getUserProfileFromMessageUser } from '../telegram_profiles';
import { buildTzmMessage, type TzaMessageMember } from '../telegram_text';
import { formatUtcOffset, formatZonedDateTime } from '../time_format';
import {
  type AiCompat,
  isPeriodicExpression,
  parseTzmAiResponse,
  runWithTimeout,
  toIsoOffset,
  TZM_AI_INFERENCE_OPTIONS,
  TZM_SYSTEM_PROMPT,
  TZM_TOOL,
} from '../tzm_ai';

const SPLIT_REGEX = /\s+/u;
const HOUR_CYCLE = 'h23' as const;

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

function formatDateTimePartsInTimeZone(timeZone: string, date: Date): DateTimeParts {
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
    throw new Error(`Unable to format current time in timezone ${timeZone}`);
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
  };
}

export function registerTzmHandler(bot: Bot, env: Env): void {
  bot.command('tzm', async (ctx: Context) => {
    const message = ctx.message;
    if (!message?.chat?.id) {
      return new Response('ok');
    }

    const chatId = String(message.chat.id);
    const chatType = message.chat.type;
    const isGroupChat = chatType === 'group' || chatType === 'supergroup';
    const isPrivateChat = chatType === 'private';
    const replyToMessageId = message.reply_to_message?.message_id ?? message.message_id;
    const reply = async (text: string): Promise<void> => {
      await ctx.reply(text, {
        reply_parameters: { message_id: replyToMessageId },
      });
    };

    if (!isGroupChat && !isPrivateChat) {
      await reply(MSG_PRIVATE_OR_GROUP_ONLY);
      return new Response('ok');
    }

    const commandExpression = parseCommandExpression(message.text);
    const repliedExpression = getTelegramMessageText(message.reply_to_message).trim();
    const expression = commandExpression || repliedExpression;
    if (!expression) {
      await reply(MSG_TZM_USAGE);
      return new Response('ok');
    }

    if (isPeriodicExpression(expression)) {
      await reply(MSG_TZM_SINGLE_POINT_ONLY);
      return new Response('ok');
    }

    await initSchema(env);

    const requester = getUserProfileFromMessageUser(message.from);
    if (!requester) {
      return new Response('ok');
    }

    const requesterTimezone = await getUserTimezone(env, requester.userId);
    if (!requesterTimezone) {
      await reply(MSG_NEED_INIT);
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
    const nowInParserTimezone = formatDateTimePartsInTimeZone(parserTimezone, now);
    const nowUtcOffset = formatUtcOffset(parserTimezone, now);
    if (!nowUtcOffset.ok) {
      throw new Error(nowUtcOffset.error);
    }

    const userLocalTime = `${nowInParserTimezone.date}T${nowInParserTimezone.time}${toIsoOffset(nowUtcOffset.value)}`;

    const contextMessages: Array<{ sender: string; text: string; time: string }> = [];
    const replyMessage = message.reply_to_message;
    if (replyMessage) {
      const replySender = getUserProfileFromMessageUser(replyMessage.from);
      const replyText = getTelegramMessageText(replyMessage);
      const replyTime = typeof replyMessage.date === 'number' ? new Date(replyMessage.date * 1000).toISOString() : '';
      if (replySender && replyText) {
        contextMessages.push({
          sender: getDisplayName(replySender),
          text: replyText,
          time: replyTime,
        });
      }
    }

    const ai = (env as Env & { AI?: AiCompat }).AI;
    if (!ai) {
      throw new Error('Missing Cloudflare AI binding');
    }

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
              user: {
                name: getDisplayName(requester),
                username: requester.username ? `@${requester.username}` : null,
                timezone: parserTimezone,
                localTime: userLocalTime,
              },
              currentTimeUtc: nowIso,
              context: contextMessages,
            }),
          },
        ],
        tools: [TZM_TOOL],
        ...TZM_AI_INFERENCE_OPTIONS,
      }),
      AI_TIMEOUT_MS,
    );

    const parsedResult = parseTzmAiResponse(aiResult);
    if (!parsedResult.ok) {
      throw new Error('Invalid time parse response from Cloudflare AI');
    }
    const parsed = parsedResult.value;

    if (!parsed.timestamp) {
      throw new Error('Cloudflare AI could not resolve the expression to a single timestamp');
    }

    const targetDate = new Date(`${parsed.timestamp}${toIsoOffset(parsed.timezone)}`);
    if (Number.isNaN(targetDate.getTime())) {
      throw new Error(`Cloudflare AI returned an invalid timestamp: ${parsed.timestamp}`);
    }

    const header = `解析为：${parsed.timestamp} (${parsed.timezone})`;

    let members: TzaMessageMember[];
    if (isGroupChat) {
      const users = await listRegisteredSeenUsers(env, chatId);
      members = users.map((user) => {
        const zonedDateTime = formatZonedDateTime(user.timezone, targetDate);
        const displayName = getDisplayName(user);
        if (!zonedDateTime.ok) {
          return { ok: false, displayName, timezone: user.timezone, error: zonedDateTime.error };
        }
        return {
          ok: true,
          displayName,
          timezone: user.timezone,
          localDate: zonedDateTime.value.date,
          localTime: zonedDateTime.value.time,
          utcOffset: zonedDateTime.value.utcOffset,
        };
      });
    } else {
      const zonedDateTime = formatZonedDateTime(requesterTimezone, targetDate);
      if (!zonedDateTime.ok) {
        members = [{ ok: false, displayName: getDisplayName(requester), timezone: requesterTimezone, error: zonedDateTime.error }];
      } else {
        members = [{
          ok: true,
          displayName: getDisplayName(requester),
          timezone: requesterTimezone,
          localDate: zonedDateTime.value.date,
          localTime: zonedDateTime.value.time,
          utcOffset: zonedDateTime.value.utcOffset,
        }];
      }
    }

    const text = buildTzmMessage(header, members);

    await reply(text);

    return new Response('ok');
  });
}
