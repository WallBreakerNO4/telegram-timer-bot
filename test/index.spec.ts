import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Worker base behavior', () => {
	it('returns 404 when token path is invalid', async () => {
		const request = new IncomingRequest('http://example.com/wrong-token', { method: 'POST' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, SECRET_TELEGRAM_API_TOKEN: 'token' }, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});
});
