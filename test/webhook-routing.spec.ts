import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_TOKEN = '123456:test_token';

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
		const response = await worker.fetch(request, { ...env, SECRET_TELEGRAM_API_TOKEN: TEST_TOKEN }, ctx);
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
