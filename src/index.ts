import { TelegramExecutionContext, type TelegramUpdate } from '@codebam/cf-workers-telegram-bot';

import { createBot } from './bot';
import { determineCommandFromContext, parseArgumentsFromContext } from './telegram_command';
import { setTelegramWebhook } from './telegram_webhook';

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    if (!env.SECRET_TELEGRAM_API_TOKEN) {
      return new Response('Missing telegram token', { status: 500 });
    }

    const token = env.SECRET_TELEGRAM_API_TOKEN;
    const url = new URL(request.url);
    if (`/${token}` !== url.pathname) {
      return new Response('Invalid token', { status: 404 });
    }

    if (request.method === 'GET' && url.searchParams.get('command') === 'set') {
      return setTelegramWebhook(token, request);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const update = await request.json().catch(() => null) as unknown;
      if (!update || typeof update !== 'object') {
        return new Response('Invalid update', { status: 400 });
      }

      console.log(update);
      const bot = createBot(token, env);
      const ctx = new TelegramExecutionContext(bot, update as TelegramUpdate);
      const args = parseArgumentsFromContext(ctx);
      const command = determineCommandFromContext(bot, ctx, args, env);
      return await bot.commands[command](ctx);
    } catch (error) {
      console.error('Error handling Telegram update:', error);
      return new Response('Error processing request', { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
