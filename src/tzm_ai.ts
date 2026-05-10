export const TZM_SYSTEM_PROMPT = [
	'你是一个时间解析器。你的任务是把用户的自然语言时间表达转换为一个单次时间点。',
	'输入会以 JSON 字符串形式提供。以下是每个字段的详细说明：',
	'',
	'【expression】',
	'用户输入的自然语言时间表达，这是你需要解析的核心内容。',
	'例如："明天下午五点"、"下周三上午10点"、"3小时后"、"日本时间明早8点"。',
	'',
	'【user】',
	'发送 /tzm 命令的用户信息，包含以下子字段：',
	'- name: 用户的显示名（如 "Alice Li"）',
	'- username: 用户的 Telegram 用户名（如 "@alice_u"），可能为 null',
	'- timezone: 用户的 IANA 时区标识符（如 "Asia/Shanghai"）',
	'  当 expression 中没有明确时区信息时，以此作为默认解析时区',
	'- localTime: 用户时区下的当前本地时间，ISO 8601 格式带时区偏移（如 "2026-02-10T00:30:00+08:00"）',
	'  **重要：相对时间（如"明天"、"下周"、"3小时后"）必须以 localTime 的日期部分为"当前日期"的唯一基准，不得用 currentTimeUtc 的日期部分推断。**',
	'',
	'【currentTimeUtc】',
	'当前的 UTC 时间，ISO 8601 格式（如 "2026-02-09T16:30:00.000Z"）。',
	'这是全局的绝对时间参考，用于计算"3 小时后"这类相对时间的时间差。',
	'',
	'【context】',
	'聊天上下文的数组，可能为空 []。每条消息包含：',
	'- sender: 发送者的显示名',
	'- text: 消息的文本内容',
	'- time: 消息的发送时间（ISO 8601 UTC 格式）',
	'当 expression 信息不完整时，可以从 context 中的对话内容推断缺失的信息。',
	'例如：对方说"下午三点见"，expression 为"好的"，则解析目标为当天下午三点。',
	'',
	'【输出字段说明】',
	'你需要输出一个 JSON 对象，包含以下字段：',
	'- timestamp: 解析结果的时间，ISO 8601 格式不含时区偏移（如 "2026-02-10T17:00:00"）',
	'- timezone: 解析结果所在的时区偏移，格式为 UTC+n 或 UTC-n 或 UTC+n:mm（如 "UTC+8"、"UTC-5"、"UTC+5:30"）',
	'',
	'【核心规则】',
	'1. 相对时间（如"明天"、"下周"、"3小时后"）必须以 user.localTime 的日期部分为"当前日期"的唯一基准，不得用 currentTimeUtc 的日期部分推断。',
	'   例：若 currentTimeUtc 为 "2026-02-09T16:30:00.000Z"（UTC 日期为 02-09），',
	'   而 user.localTime 为 "2026-02-10T00:30:00+08:00"（本地日期为 02-10），',
	'   则"明天"应为 02-11 而非 02-10。',
	'2. 如果 expression 中包含明确的时区信息（如"日本"、"东京"、"UTC"、"纽约"、"北京时间"等），',
	'   timezone 应使用该时区对应的 UTC 偏移（如日本 → "UTC+9"、纽约 → "UTC-5" 或 "UTC-4"视夏令时而定）。',
	'3. 如果 expression 中不包含时区信息，timezone 使用 user.timezone 对应的 UTC 偏移。',
	'4. 如果无法解析为单次时间点，timestamp 和 timezone 均返回空字符串 ""。',
	'5. 只输出 JSON，不要输出任何额外文本。',
].join('\n');

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

	const envelope = aiResult as { response?: unknown };
	if (!envelope.response || typeof envelope.response !== 'object') {
		return { ok: false };
	}

	const response = envelope.response as Record<string, unknown>;
	if (typeof response.timestamp !== 'string' || typeof response.timezone !== 'string') {
		return { ok: false };
	}

	if (response.timestamp !== '' && Number.isNaN(new Date(response.timestamp).getTime())) {
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
