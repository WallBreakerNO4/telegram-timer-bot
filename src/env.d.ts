declare global {
	interface Env {
		SECRET_TELEGRAM_API_TOKEN: string;
		TELEGRAM_BOT_USERNAME?: string;
		OPENAI_API_KEY: string;
		OPENAI_BASE_URL?: string;
	}
}

export {};
