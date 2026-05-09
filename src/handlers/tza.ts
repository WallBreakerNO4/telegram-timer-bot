import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { initSchema, listRegisteredSeenUsers } from '../db';
import { MSG_GROUP_ONLY } from '../messages';
import { type TelegramApiCompat } from '../telegram_api';
import { getDisplayName } from '../telegram_profiles';
import { buildTzaMessage } from '../telegram_text';
import { formatLocalTime, formatUtcOffset } from '../time_format';

export function registerTzaHandler(bot: TelegramBot, env: Env): void {
  bot.on('tza', async (ctx: TelegramExecutionContext) => {
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
        text: MSG_GROUP_ONLY,
        parse_mode: '',
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

    await api.sendMessage(ctx.bot.api.toString(), {
      chat_id: chatId,
      reply_to_message_id: message.message_id,
      text,
      parse_mode: '',
    });

    return new Response('ok');
  });
}
