import { type Bot, type Context } from 'grammy';

import { initSchema, listRegisteredSeenUsers } from '../db';
import { MSG_GROUP_ONLY } from '../messages';
import { getDisplayName } from '../telegram_profiles';
import { buildTzaMessage, type TzaMessageMember } from '../telegram_text';
import { formatZonedDateTime } from '../time_format';
import { sendEphemeralReply } from './ephemeral_reply';

export function registerTzaHandler(bot: Bot, env: Env): void {
  bot.command('tza', async (ctx: Context) => {
    const message = ctx.message;
    if (!message?.chat?.id) {
      return new Response('ok');
    }

    const chatId = String(message.chat.id);

    if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') {
      await sendEphemeralReply(ctx, env, MSG_GROUP_ONLY, {
        replyToMessageId: message.message_id,
      });
      return new Response('ok');
    }

    await initSchema(env);
    const users = await listRegisteredSeenUsers(env, chatId);
    const now = new Date();
    const members: TzaMessageMember[] = users.map((user) => {
      const zonedDateTime = formatZonedDateTime(user.timezone, now);
      const displayName = getDisplayName(user);
      if (!zonedDateTime.ok) {
        return {
          ok: false,
          displayName,
          timezone: user.timezone,
          error: zonedDateTime.error,
        };
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
    const text = buildTzaMessage(members);

    await sendEphemeralReply(ctx, env, text, {
      replyToMessageId: message.message_id,
      withShareButton: true,
    });

    return new Response('ok');
  });
}
