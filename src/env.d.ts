declare global {
	interface Env {
		SECRET_TELEGRAM_API_TOKEN: string;
		TELEGRAM_BOT_USERNAME?: string;
	}
}

export {};
