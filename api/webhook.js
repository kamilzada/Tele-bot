// Telegram delivers every message sent to the bot here (POST /api/webhook).
import { config } from '../lib/config.js';
import { handleNote, handleReview } from '../lib/pipeline.js';
import { sendMessage, answerCallback, removeButtons } from '../lib/telegram.js';

const HELP = `Send me any note — an observation, a customer DM reaction, something you read.

I'll score it 0-10. Notes scoring ${config.minScore}+ come back as a LinkedIn draft in your voice, with a news angle if a relevant one exists. Nothing is ever posted for you.

Reply APPROVE or REJECT to a draft to record your decision.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    // Health check. Reports which settings are present (never their values).
    return res.status(200).json({
      ok: true,
      service: 'meera-content-bot',
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
    const text = (msg?.text ?? msg?.caption ?? '').trim();
    chatId = msg?.chat?.id;
    if (!msg || !isAllowed(chatId)) return res.status(200).json({ ok: true });

    if (!text) {
      await sendMessage(chatId, 'I can only read text notes right now. Send the note as text (or paste the voice-note transcript).');
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
