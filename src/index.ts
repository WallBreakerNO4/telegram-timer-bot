import { getWebhookHandler } from './bot';
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

    const update = await request.clone().json() as unknown;
    if (!update || typeof update !== 'object') {
      return new Response('Invalid update', { status: 400 });
    }

    console.log(update);
    return getWebhookHandler(token, env)(request);
  },
} satisfies ExportedHandler<Env>;
