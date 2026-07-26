import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = '123456:test_token';
const TEST_BOT_USERNAME = 'timer_test_bot';

function createTelegramOkResponse(): Response {
	return new Response(JSON.stringify({ ok: true, result: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function createStartUpdate(): Record<string, unknown> {
	return {
		update_id: 1,
		message: {
			message_id: 10,
			date: 1700000000,
			text: '/start',
			chat: {
				id: 42,
				type: 'private',
			},
			from: {
				id: 7,
				is_bot: false,
				first_name: 'tester',
			},
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Webhook routing', () => {
	it('propagates malformed JSON errors', async () => {
		const request = new IncomingRequest(`https://example.com/${TEST_TOKEN}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{not-json',
		});
		const ctx = createExecutionContext();
		await expect(worker.fetch(request, { ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN }, ctx)).rejects.toThrow();
	});

	it('returns 400 when the webhook JSON is not an object', async () => {
		const request = new IncomingRequest(`https://example.com/${TEST_TOKEN}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(null),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN, TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
	});

	it('returns 405 for a valid token with an unsupported method', async () => {
		const request = new IncomingRequest(`https://example.com/${TEST_TOKEN}`, { method: 'PUT' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN, TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(405);
	});

	it('handles POST /{token} and triggers Telegram API call', async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const request = new IncomingRequest(`https://example.com/${TEST_TOKEN}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(createStartUpdate()),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN, TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		const firstCallInput = outboundFetch.mock.calls[0][0];
		const firstCallUrl = firstCallInput instanceof Request ? firstCallInput.url : String(firstCallInput);
		expect(firstCallUrl).toContain('https://api.telegram.org/bot');
	});

	it('returns 404 for POST /wrong-token', async () => {
		const request = new IncomingRequest('https://example.com/wrong-token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(createStartUpdate()),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
	});

	it('calls setWebhook for GET /{token}?command=set', async () => {
		const outboundFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
			async () => createTelegramOkResponse(),
		);
		vi.stubGlobal('fetch', outboundFetch);

		const request = new IncomingRequest(`https://example.com/${TEST_TOKEN}?command=set`, {
			method: 'GET',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		const firstCallInput = outboundFetch.mock.calls[0][0];
		const firstCallUrl = firstCallInput instanceof Request ? firstCallInput.url : String(firstCallInput);
		expect(firstCallUrl).toContain('/setWebhook?');
		expect(decodeURIComponent(firstCallUrl)).toContain(`url=https://example.com/${TEST_TOKEN}`);
		const allowedUpdates = new URL(firstCallUrl).searchParams.get('allowed_updates');
		expect(allowedUpdates).not.toBeNull();
		expect(JSON.parse(allowedUpdates ?? '[]')).toContain('callback_query');
	});
});
