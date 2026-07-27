import { describe, expect, it } from 'vitest';

import { parseTzmAiResponse } from '../src/tzm_ai';

function createToolCall(argumentsValue: string, name = 'resolve_time'): unknown {
	return {
		choices: [
			{
				message: {
					tool_calls: [
						{
							type: 'function',
							function: {
								name,
								arguments: argumentsValue,
							},
						},
					],
				},
			},
		],
	};
}

describe('parseTzmAiResponse', () => {
	it('解析 GLM function calling 返回的参数', () => {
		const result = parseTzmAiResponse(
			createToolCall(JSON.stringify({ timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8' })),
		);

		expect(result).toEqual({
			ok: true,
			value: {
				timestamp: '2026-07-27T17:00:00',
				timezone: 'UTC+8',
			},
		});
	});

	it('允许用成对空字符串表示无法解析单次时间点', () => {
		const result = parseTzmAiResponse(createToolCall(JSON.stringify({ timestamp: '', timezone: '' })));

		expect(result).toEqual({ ok: true, value: { timestamp: '', timezone: '' } });
	});

	it.each([
		['旧 response envelope', { response: { timestamp: '2026-07-27T17:00:00', timezone: 'UTC+8' } }],
		['错误工具名', createToolCall('{"timestamp":"2026-07-27T17:00:00","timezone":"UTC+8"}', 'other_tool')],
		['非法 JSON 参数', createToolCall('{not-json')],
		['非法当地时间格式', createToolCall('{"timestamp":"2026-07-27T17:00:00Z","timezone":"UTC+8"}')],
		['非法时区格式', createToolCall('{"timestamp":"2026-07-27T17:00:00","timezone":"+08:00"}')],
	])('拒绝%s', (_label, aiResult) => {
		expect(parseTzmAiResponse(aiResult)).toEqual({ ok: false });
	});
});
