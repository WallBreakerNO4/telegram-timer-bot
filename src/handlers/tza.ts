import { type Bot, type Context } from 'grammy';

import { initSchema, listRegisteredSeenUsers } from '../db';
import { MSG_GROUP_ONLY } from '../messages';
import { getDisplayName } from '../telegram_profiles';
import { buildTzaMessage } from '../telegram_text';
import { formatLocalTime, formatUtcOffset } from '../time_format';

export function registerTzaHandler(bot: Bot, env: Env): void {
  bot.command('tza', async (ctx: Context) => {
    const message = ctx.message;
    if (!message?.chat?.id) {
      return new Response('ok');
    }

    const chatId = String(message.chat.id);

    if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') {
      await ctx.reply(MSG_GROUP_ONLY, {
        reply_parameters: { message_id: message.message_id },
      });
      return new Response('ok');
    }

    await initSchema(env);
    const users = await listRegisteredSeenUsers(env, chatId);
    const now = new Date();
    const lines = users.map((user) => {
      const localTime = formatLocalTime(user.timezone, now);
      const displayName = getDisplayName(user);
      if (!localTime.ok) {
        return `${displayName}: ${localTime.error}`;
      }
      const utcOffset = formatUtcOffset(user.timezone, now);
      if (!utcOffset.ok) {
        return `${displayName}: ${utcOffset.error}`;
      }
      return `${utcOffset.value} (${localTime.value}) | ${displayName}`;
    });
    const text = buildTzaMessage(lines);

    await ctx.reply(text, {
      reply_parameters: { message_id: message.message_id },
    });

    return new Response('ok');
  });
}
