import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { MSG_CHOOSE_REGION, MSG_PRIVATE_ONLY } from '../messages';
import { type TelegramApiCompat } from '../telegram_api';
import { buildRegionSelectorMarkup } from './timezone_keyboard';

export function registerStartHandlers(bot: TelegramBot, supportedTimezones: readonly string[]): void {
  const handler = async (ctx: TelegramExecutionContext) => {
    const message = ctx.update.message;
    if (!message?.chat?.id) {
      return new Response('ok');
    }

    if (message.chat.type !== 'private') {
      return (await ctx.reply(MSG_PRIVATE_ONLY)) ?? new Response('ok');
    }

    const markup = buildRegionSelectorMarkup(supportedTimezones);
    await (ctx.api as unknown as TelegramApiCompat).sendMessage(ctx.bot.api.toString(), {
      chat_id: String(message.chat.id),
      reply_to_message_id: message.message_id,
      text: MSG_CHOOSE_REGION,
      reply_markup: markup,
      parse_mode: '',
    });

    return new Response('ok');
  };

  bot.on('start', handler);
  bot.on('changetz', handler);
}
