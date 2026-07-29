import { describe, expect, it } from 'vitest';

import { TZM_PARSE_SCHEMA, validateTzmParseResult } from '../src/tzm_ai';

describe('TZM_PARSE_SCHEMA', () => {
	it('解析合法的 structured output', () => {
		const result = TZM_PARSE_SCHEMA.safeParse({ timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8' });

		expect(result.success).toBe(true);
	});

	it('允许用成对空字符串表示无法解析单次时间点', () => {
		const result = TZM_PARSE_SCHEMA.safeParse({ timestamp: '', timezone: '' });

		expect(result.success).toBe(true);
	});

	it.each([
		['非法当地时间格式', { timestamp: '2026-07-27T17:00:00Z', timezone: 'UTC+8' }],
		['非法时区格式', { timestamp: '2026-07-27T17:00:00', timezone: '+08:00' }],
		['缺少字段', { timestamp: '2026-07-27T17:00:00' }],
		['额外字段', { timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8', extra: true }],
	])('拒绝%s', (_label, value) => {
		expect(TZM_PARSE_SCHEMA.safeParse(value).success).toBe(false);
	});
});

describe('validateTzmParseResult', () => {
	it('接受成对的有效值', () => {
		expect(validateTzmParseResult({ timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8' })).toEqual({
			ok: true,
			value: { timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8' },
		});
	});

	it.each([
		{ timestamp: '', timezone: 'UTC+8' },
		{ timestamp: '2026-07-27T17:00:00', timezone: '' },
	])('拒绝只有一个字段为空的结果', (value) => {
		expect(validateTzmParseResult(value)).toEqual({ ok: false });
	});
});
