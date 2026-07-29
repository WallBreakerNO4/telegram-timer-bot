import { z } from 'zod';

export const TZM_SYSTEM_PROMPT = [
	'你是时间解析器。将用户的自然语言时间表达解析为一个单次时间点。',
	'没有日期时使用 user.localTime 的当地日期；相对时间也以 user.localTime 为基准。',
	'没有明确时区时使用 user.timezone。信息不完整时可结合 context 推断。',
	'timestamp 必须保留目标时区的当地墙上时间，绝对不得换算成 UTC。',
	'无法解析为单次时间点时，timestamp 和 timezone 都返回空字符串。',
].join('\n');

export const TZM_PARSE_SCHEMA = z
	.object({
		timestamp: z
			.string()
			.regex(/^(?:|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/u)
			.describe('目标时区的当地墙上时间，格式 YYYY-MM-DDTHH:mm:ss；无法解析时为空字符串'),
		timezone: z
			.string()
			.regex(/^(?:|UTC[+-]\d{1,2}(?::\d{2})?)$/u)
			.describe('目标当地时间对应的 UTC 偏移，格式 UTC+n、UTC-n 或 UTC+n:mm；无法解析时为空字符串'),
	})
	.strict();

export const TZM_AI_INFERENCE_OPTIONS = {
	max_tokens: 384,
	temperature: 0,
} as const;

export type TzmParseResult = z.infer<typeof TZM_PARSE_SCHEMA>;

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

export function validateTzmParseResult(result: TzmParseResult): ParseResult<TzmParseResult> {
	if ((result.timestamp === '') !== (result.timezone === '')) {
		return { ok: false };
	}

	return {
		ok: true,
		value: result,
	};
}
