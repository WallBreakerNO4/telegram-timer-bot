// OpenAI 兼容端点
export const OPENAI_MODEL = 'deepseek-chat' as const;
export const OPENAI_DEFAULT_BASE_URL = 'https://api.deepseek.com' as const;
export const AI_TIMEOUT_MS = 30000;

// 本地化
export const LOCALE = 'en' as const;

// Webhook
export const WEBHOOK_MAX_CONNECTIONS = 100;

// 时区
export const EXCLUDED_TZ_REGION = 'Etc' as const;
