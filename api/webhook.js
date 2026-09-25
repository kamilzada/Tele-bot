// Telegram delivers every message sent to the bot here (POST /api/webhook).
import { config } from '../lib/config.js';
import { handleNote, handleReview } from '../lib/pipeline.js';
import { sendMessage, sendTyping, answerCallback, removeButtons, downloadFile } from '../lib/telegram.js';
import { transcribe } from '../lib/llm.js';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // Telegram's bot download limit

const HELP = `Send me any note, typed or as a voice note — an observation, a customer DM reaction, something you read.

I'll score it 0-10. Notes scoring ${config.minScore}+ come back as a LinkedIn draft in your voice, with a news angle if a relevant one exists. Nothing is ever posted for you.

Reply APPROVE or REJECT to a draft to record your decision.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    // Health check. Reports which settings are present (never their values),
    // which bot the token belongs to, and what Telegram sees for the webhook.
    const [bot, webhook] = await Promise.all([
      getTelegram('getMe'),
      getTelegram('getWebhookInfo'),
    ]);
    return res.status(200).json({
      ok: true,
      service: 'meera-content-bot',
      bot: bot.ok ? `@${bot.result.username}` : `token rejected by Telegram: ${bot.description}`,
      webhook: webhook.ok
        ? {
            url: webhook.result.url,
            pending: webhook.result.pending_update_count,
            lastError: webhook.result.last_error_message ?? null,
            lastErrorAt: webhook.result.last_error_date
              ? new Date(webhook.result.last_error_date * 1000).toISOString()
              : null,
            allowedUpdates: webhook.result.allowed_updates ?? 'default',
          }
        : webhook.description,
      config: {
        telegramToken: Boolean(config.telegramToken),
        geminiKey: Boolean(config.geminiKey),
        anthropicKey: Boolean(config.anthropicKey),
        supabase: Boolean(config.supabaseUrl && config.supabaseKey),
        webhookSecret: Boolean(config.webhookSecret),
        allowedChatIdsCount: config.allowedChatIds.length,
        minScore: config.minScore,
      },
    });
  }
  if (config.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) {
    return res.status(401).json({ ok: false });
  }

  const update = req.body ?? {};
  let chatId;

  try {
    // Button taps on a draft (Approve / Reject)
    if (update.callback_query) {
      const cq = update.callback_query;
      chatId = cq.message?.chat?.id;
      if (!isAllowed(chatId)) return res.status(200).json({ ok: true });

      const [action, draftId] = String(cq.data ?? '').split(':');
      const status = action === 'approve' ? 'approved' : 'rejected';
      const draft = await handleReview({ chatId, status, draftId });
      await answerCallback(cq.id, draft ? `Marked ${status}` : 'Draft not found');
      if (draft) {
        await removeButtons(chatId, cq.message.message_id);
        await sendMessage(chatId, confirmation(status), { replyTo: cq.message.message_id });
      }
      return res.status(200).json({ ok: true });
    }

    // Works for a private chat with the bot, a group, or a channel the bot is admin of.
    const msg = update.message ?? update.channel_post;
    let text = (msg?.text ?? msg?.caption ?? '').trim();
    chatId = msg?.chat?.id;
    if (!msg || !isAllowed(chatId)) return res.status(200).json({ ok: true });

    // Voice notes (and audio files): transcribe, show Meera the transcript, then treat it as a note.
    const audio = msg.voice ?? msg.audio;
    if (audio) {
      if (audio.file_size > MAX_AUDIO_BYTES) {
        await sendMessage(chatId, 'That voice note is too long for me to process (over 20 MB). Try splitting it into shorter notes.', { replyTo: msg.message_id });
        return res.status(200).json({ ok: true });
      }
      await sendTyping(chatId);
      const buffer = await downloadFile(audio.file_id);
      const transcript = await transcribe(buffer, audio.mime_type || 'audio/ogg');
      if (!transcript || transcript === '[inaudible]') {
        await sendMessage(chatId, 'I could not make out any words in that voice note. Try again somewhere quieter, or type it.', { replyTo: msg.message_id });
        return res.status(200).json({ ok: true });
      }
      await sendMessage(chatId, `Transcript:\n${transcript}`, { replyTo: msg.message_id });
      text = [text, transcript].filter(Boolean).join('\n\n'); // keep any caption she added
    }

    if (!text) {
      await sendMessage(chatId, 'I can read text notes and voice notes. Send one of those and I will score it.');
      return res.status(200).json({ ok: true });
    }

    if (/^\/(start|help)\b/i.test(text)) {
      await sendMessage(chatId, `${HELP}\n\nYour chat ID: ${chatId}`);
      return res.status(200).json({ ok: true });
    }

    const review = text.match(/^(approve|approved|reject|rejected)\.?$/i);
    if (review) {
      const status = review[1].toLowerCase().startsWith('approve') ? 'approved' : 'rejected';
      const replyTo = msg.reply_to_message?.message_id;
      const draft = await handleReview({ chatId, status, replyToMessageId: replyTo });
      if (draft) {
        if (draft.telegram_message_id) await removeButtons(chatId, draft.telegram_message_id);
        await sendMessage(chatId, confirmation(status), { replyTo: msg.message_id });
      }
      return res.status(200).json({ ok: true });
    }

    await handleNote({ chatId, updateId: update.update_id, messageId: msg.message_id, text });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    if (chatId) {
      await sendMessage(chatId, `Something went wrong while processing that note:\n${err.message}`).catch(() => {});
    }
    // Always 200 so Telegram doesn't keep re-sending the same update.
    return res.status(200).json({ ok: false });
  }
}

async function getTelegram(method) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`);
    return await r.json();
  } catch (err) {
    return { ok: false, description: err.message };
  }
}

function isAllowed(chatId) {
  if (chatId === undefined || chatId === null) return false;
  const allowed = config.allowedChatIds.length === 0 || config.allowedChatIds.includes(String(chatId));
  if (!allowed) console.warn(`Ignored message from chat ${chatId}: not in ALLOWED_CHAT_IDS (${config.allowedChatIds.join(', ')})`);
  return allowed;
}

const confirmation = (status) =>
  status === 'approved'
    ? 'Approved and saved. Post it on LinkedIn when you are ready — it has not been published anywhere.'
    : 'Rejected and saved. Kept on record so the scoring and drafting can be improved.';
