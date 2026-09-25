const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;

export const config = {
  telegramToken: env('TELEGRAM_BOT_TOKEN'),
  webhookSecret: env('TELEGRAM_WEBHOOK_SECRET'),
  allowedChatIds: env('ALLOWED_CHAT_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  geminiKey: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL', 'gemini-2.5-flash'),

  anthropicKey: env('ANTHROPIC_API_KEY'),
  claudeModel: env('CLAUDE_MODEL', 'claude-sonnet-5'),

  supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
  supabaseKey: env('SUPABASE_SERVICE_KEY'),

  minScore: Number(env('MIN_SCORE', '6')),
};

export const hasStore = () => Boolean(config.supabaseUrl && config.supabaseKey);
