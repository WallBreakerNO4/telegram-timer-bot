import { type Bot, type Context } from 'grammy';

import { getUserTimezone, initSchema, markSeen } from '../db';
import { MSG_NEED_INIT } from '../messages';
import { getDisplayName, getUserProfileFromMessageUser } from '../telegram_profiles';
import { formatLocalTime, formatUtcOffset } from '../time_format';

export function registerTzHandler(bot: Bot, env: Env): void {
  bot.command('tz', async (ctx: Context) => {
    const message = ctx.message;
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
      : MSG_NEED_INIT;

    await ctx.reply(text, {
      reply_parameters: { message_id: replyToMessageId },
    });

    return new Response('ok');
  });
}
