import { type Bot, type Context } from 'grammy';

import { MSG_CHOOSE_REGION, MSG_PRIVATE_ONLY } from '../messages';
import { buildRegionSelectorMarkup } from './timezone_keyboard';
import { sendEphemeralReply } from './ephemeral_reply';

export function registerStartHandlers(bot: Bot, env: Env, supportedTimezones: readonly string[]): void {
  const handler = async (ctx: Context) => {
    const message = ctx.message;
    if (!message?.chat?.id) {
      return new Response('ok');
    }

    if (message.chat.type !== 'private') {
      await sendEphemeralReply(ctx, env, MSG_PRIVATE_ONLY, {
        replyToMessageId: message.message_id,
      });
      return new Response('ok');
    }

    const markup = buildRegionSelectorMarkup(supportedTimezones);
    await ctx.reply(MSG_CHOOSE_REGION, {
      reply_parameters: { message_id: message.message_id },
      reply_markup: markup,
    });

    return new Response('ok');
  };

  bot.command('start', handler);
  bot.command('changetz', handler);
}
