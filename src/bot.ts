import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { registerCallbackHandler } from './handlers/callback';
import { registerStartHandlers } from './handlers/start';
import { registerTzHandler } from './handlers/tz';
import { registerTzaHandler } from './handlers/tza';
import { registerTzmHandler } from './handlers/tzm';
import { getSupportedTimezones } from './timezones';

type TelegramHandler = (ctx: TelegramExecutionContext) => Promise<Response>;

const placeholderHandler: TelegramHandler = async () => new Response('ok');

export function createBot(token: string, env: Env): TelegramBot {
  const bot = new TelegramBot(token);
  const supportedTimezones = getSupportedTimezones();

  registerStartHandlers(bot, supportedTimezones);
  registerTzHandler(bot, env);
  registerTzaHandler(bot, env);
  registerTzmHandler(bot, env);
  registerCallbackHandler(bot, env, supportedTimezones);

  bot.on(':message', placeholderHandler);

  return bot;
}
