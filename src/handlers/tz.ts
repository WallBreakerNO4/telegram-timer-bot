import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { getUserTimezone, initSchema, markSeen } from '../db';
import { type TelegramApiCompat } from '../telegram_api';
import { getDisplayName, getUserProfileFromMessageUser } from '../telegram_profiles';
import { formatLocalTime, formatUtcOffset } from '../time_format';

export function registerTzHandler(bot: TelegramBot, env: Env): void {
  bot.on('tz', async (ctx: TelegramExecutionContext) => {
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
    const targetProfile = replyTarget ?? requester;
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
          const now = new Date();
          const localTime = formatLocalTime(timezone, now);
          if (!localTime.ok) {
            return localTime.error;
          }
          const utcOffset = formatUtcOffset(timezone, now);
          if (!utcOffset.ok) {
            return utcOffset.error;
          }
          return `${utcOffset.value} (${localTime.value}) | ${getDisplayName(targetProfile)}`;
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
}
