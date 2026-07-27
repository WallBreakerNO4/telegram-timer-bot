export const TZM_SYSTEM_PROMPT = [
	'你是时间解析器。必须且只能调用一次 resolve_time。',
	'没有日期时使用 user.localTime 的当地日期；相对时间也以 user.localTime 为基准。',
	'没有明确时区时使用 user.timezone。信息不完整时可结合 context 推断。',
	'timestamp 必须保留目标时区的当地墙上时间，绝对不得换算成 UTC。',
	'无法解析为单次时间点时，两个参数都传空字符串。',
].join('\n');

export const TZM_TOOL_NAME = 'resolve_time' as const;

export const TZM_TOOL = {
	type: 'function',
	function: {
		name: TZM_TOOL_NAME,
		description: '提交最终且唯一的时间解析结果',
		parameters: {
			type: 'object',
			properties: {
				timestamp: {
					type: 'string',
					description: '目标时区的当地墙上时间，格式 YYYY-MM-DDTHH:mm:ss；禁止换算为 UTC',
				},
				timezone: {
					type: 'string',
					description: '目标当地时间对应的 UTC 偏移，格式 UTC+n、UTC-n 或 UTC+n:mm',
				},
			},
			required: ['timestamp', 'timezone'],
		},
	},
} as const;

export const TZM_AI_INFERENCE_OPTIONS = {
	tool_choice: 'required',
	reasoning_effort: 'low',
	max_completion_tokens: 384,
	temperature: 0,
} as const;

export interface AiCompat {
	run: (model: string, request: Record<string, unknown>) => Promise<unknown>;
}

export interface TzmParseResult {
	timestamp: string;
	timezone: string;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false };

export function isPeriodicExpression(expression: string): boolean {
	return /每(日|天|周|月|年|星期|礼拜|周[一二三四五六日天])/u.test(expression);
}

export function toIsoOffset(utcOffset: string): string {
	const offset = utcOffset.replace(/^UTC/, '');
	if (!offset) return '';

	const sign = offset.charAt(0);
	const rest = offset.slice(1);
	const [h, m = '00'] = rest.includes(':') ? rest.split(':') : [rest, '00'];
	return `${sign}${h.padStart(2, '0')}:${m}`;
}

export function parseTzmAiResponse(aiResult: unknown): ParseResult<TzmParseResult> {
	if (!aiResult || typeof aiResult !== 'object') {
		return { ok: false };
	}

	const choices = (aiResult as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length !== 1) {
		return { ok: false };
	}

	const choice = choices[0];
	if (!choice || typeof choice !== 'object') {
		return { ok: false };
	}

	const message = (choice as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		return { ok: false };
	}

	const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
	if (!Array.isArray(toolCalls) || toolCalls.length !== 1) {
		return { ok: false };
	}

	const toolCall = toolCalls[0];
	if (!toolCall || typeof toolCall !== 'object') {
		return { ok: false };
	}

	const fn = (toolCall as { function?: unknown }).function;
	if (!fn || typeof fn !== 'object') {
		return { ok: false };
	}

	const functionCall = fn as { name?: unknown; arguments?: unknown };
	if (functionCall.name !== TZM_TOOL_NAME || typeof functionCall.arguments !== 'string') {
		return { ok: false };
	}

	let response: Record<string, unknown>;
	try {
		const parsed = JSON.parse(functionCall.arguments) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { ok: false };
		}
		response = parsed as Record<string, unknown>;
	} catch {
		return { ok: false };
	}

	if (typeof response.timestamp !== 'string' || typeof response.timezone !== 'string') {
		return { ok: false };
	}

	const timestampPattern = /^(?:|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/;
	if (!timestampPattern.test(response.timestamp)) {
		return { ok: false };
	}

	const tzPattern = /^(?:|UTC[+-]\d{1,2}(?::\d{2})?)$/;
	if (!tzPattern.test(response.timezone)) {
		return { ok: false };
	}

	if ((response.timestamp === '') !== (response.timezone === '')) {
		return { ok: false };
	}

	return {
		ok: true,
		value: {
			timestamp: response.timestamp,
			timezone: response.timezone,
		},
	};
}

export async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => reject(new Error('timeout')), timeoutMs);
	});

	return Promise.race([promise, timeoutPromise]);
}
