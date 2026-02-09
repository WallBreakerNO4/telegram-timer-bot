const TELEGRAM_WEBHOOK_ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'inline_query',
  'business_message',
  'business_connection',
] as const;

export async function setTelegramWebhook(token: string, request: Request): Promise<Response> {
  const apiBase = `https://api.telegram.org/bot${token}`;
  const url = new URL(`${apiBase}/setWebhook`);
  const webhookUrl = `${new URL(request.url).origin}/${token}`;
  const params = new URLSearchParams({
    url: webhookUrl,
    max_connections: '100',
    allowed_updates: JSON.stringify(TELEGRAM_WEBHOOK_ALLOWED_UPDATES),
    drop_pending_updates: 'true',
  });

  return fetch(`${url.toString()}?${params.toString()}`);
}
