export const TZM_SYSTEM_PROMPT = [
  '你是一个时间解析器。你的任务是把用户的自然语言时间表达转换为一个单次时间点。',
  '输入会以 JSON 字符串形式提供：{ expression, requesterTimezone, currentTimeUtc, currentDateInRequesterTimezone, currentTimeInRequesterTimezone, currentUtcOffsetInRequesterTimezone }。',
  '注意：currentTimeUtc 是 UTC 时间；相对时间（如“明天”）必须以 currentDateInRequesterTimezone 作为“当前日期”的唯一基准，不得用 UTC 的日期部分推断。',
  // '',
  // '【时区处理规则】',
  // '1. 首先分析 expression 是否包含明确的时区信息（如"日本"、"东京"、"UTC"、"纽约"、"北京时间"等）',
  // '2. 如果 expression 包含明确的时区信息，使用该时区作为目标时区进行解析',
  // '3. 如果 expression 不包含时区信息，使用 requesterTimezone 作为默认时区',
  // '4. 对于相对时间（如"明天"、"下周"），以 targetTimezone 的当前日期为基准进行计算；该“当前日期”以输入字段 currentDateInRequesterTimezone 为准。',
  // '',
  // '【输出要求】',
  // '输出必须严格符合提供的 JSON Schema：',
  // '- ok: boolean（能解析为单次时间点则 true）',
  // '- isoTimestamp: string（RFC3339/ISO8601，必须包含时区偏移，例如 2026-02-10T17:00:00+08:00 或 2026-02-10T18:00:00+09:00）',
  // "- confidence: 'high' | 'medium' | 'low'",
  // '- assumptions: string[]（若需要补全日期/时间/年份等，或需要推断时区时，说明采用的假设）',
  // '- error: string（ok=false 时给出简短原因；ok=true 时为空字符串）',
  // '只输出 JSON，不要输出任何额外文本。',
].join('\n');

export interface AiCompat {
  run: (model: string, request: Record<string, unknown>) => Promise<unknown>;
}

export interface TzmParseResult {
  ok: boolean;
  isoTimestamp: string;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  error: string;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false };

export function isPeriodicExpression(expression: string): boolean {
  return /每(日|天|周|月|年|星期|礼拜|周[一二三四五六日天])/u.test(expression);
}

function isTzmConfidence(value: unknown): value is TzmParseResult['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low';
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
  if (
    typeof response.ok !== 'boolean' ||
    typeof response.isoTimestamp !== 'string' ||
    !isTzmConfidence(response.confidence) ||
    !Array.isArray(response.assumptions) ||
    response.assumptions.some((item) => typeof item !== 'string') ||
    typeof response.error !== 'string'
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      ok: response.ok,
      isoTimestamp: response.isoTimestamp,
      confidence: response.confidence,
      assumptions: response.assumptions,
      error: response.error,
    },
  };
}

export async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}
