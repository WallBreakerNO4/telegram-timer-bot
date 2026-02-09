import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { getUserTimezone, initSchema, listRegisteredSeenUsers, markSeen } from '../db';
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

function parseCommandExpression(text: string | undefined): string {
  if (!text) {
    return '';
  }

  const tokens = text.trim().split(/\s+/u);
  if (tokens.length <= 1) {
    return '';
  }

  return tokens.slice(1).join(' ').trim();
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
    if (!isGroupChat && !isPrivateChat) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: '仅群聊或私聊可用',
        parse_mode: '',
      });
      return new Response('ok');
    }

    const expression = parseCommandExpression(message.text);
    if (!expression) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: '用法：/tzm 明天下午五点',
        parse_mode: '',
      });
      return new Response('ok');
    }

    if (isPeriodicExpression(expression)) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: '仅支持单次时间点',
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
        reply_to_message_id: message.message_id,
        text: '请私聊 bot 用 /start 初始化',
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

    const nowIso = new Date().toISOString();
    const parseFailureText = '解析失败：请用更具体的表达，例如：/tzm 明天下午五点';
    const schema = {
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

    const ai = (env as Env & { AI?: AiCompat }).AI;
    if (!ai) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: parseFailureText,
        parse_mode: '',
      });
      return new Response('ok');
    }

    let parsed: TzmParseResult;
    try {
      const aiResult = await runWithTimeout(
        ai.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            {
              role: 'system',
              content: TZM_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: JSON.stringify({
                expression,
                requesterTimezone,
                currentTime: nowIso,
              }),
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: schema,
          },
        }),
        8000,
      );

      const parsedResult = parseTzmAiResponse(aiResult);
      if (!parsedResult.ok) {
        await api.sendMessage(ctx.bot.api.toString(), {
          chat_id: chatId,
          reply_to_message_id: message.message_id,
          text: parseFailureText,
          parse_mode: '',
        });
        return new Response('ok');
      }

      parsed = parsedResult.value;
    } catch {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: parseFailureText,
        parse_mode: '',
      });
      return new Response('ok');
    }

    if (!parsed.ok) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: parseFailureText,
        parse_mode: '',
      });
      return new Response('ok');
    }

    const targetDate = new Date(parsed.isoTimestamp);
    if (Number.isNaN(targetDate.getTime())) {
      await api.sendMessage(ctx.bot.api.toString(), {
        chat_id: chatId,
        reply_to_message_id: message.message_id,
        text: parseFailureText,
        parse_mode: '',
      });
      return new Response('ok');
    }

    const assumptionSuffix = parsed.assumptions.length > 0 ? `（假设：${parsed.assumptions.join('；')}）` : '';
    const confidenceSuffix = parsed.confidence === 'low' ? '（低置信度）' : '';
    const header = `解析为：${parsed.isoTimestamp} (${requesterTimezone})${assumptionSuffix}${confidenceSuffix}`;

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
      reply_to_message_id: message.message_id,
      text,
      parse_mode: '',
    });

    return new Response('ok');
  });
}
