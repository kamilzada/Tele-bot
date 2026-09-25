import { config } from './config.js';

const TELEGRAM_LIMIT = 4000; // hard limit is 4096; leave headroom

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
  return data.result;
}

// Split long text on paragraph boundaries so each piece fits in one message.
function chunk(text) {
  if (text.length <= TELEGRAM_LIMIT) return [text];
  const parts = [];
  let current = '';
  for (const para of text.split('\n\n')) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length > TELEGRAM_LIMIT && current) {
      parts.push(current);
      current = para;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.flatMap((p) =>
    p.length <= TELEGRAM_LIMIT ? [p] : p.match(new RegExp(`[\\s\\S]{1,${TELEGRAM_LIMIT}}`, 'g'))
  );
}

// Sends plain text (no parse_mode, so drafts never break on stray * or _).
// Buttons, if given, go on the last message. Returns the last sent message.
export async function sendMessage(chatId, text, { buttons, replyTo } = {}) {
  const parts = chunk(text);
  let last;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    last = await call('sendMessage', {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
      ...(i === 0 && replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      ...(isLast && buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }
  return last;
}

export const sendTyping = (chatId) =>
  call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

export const answerCallback = (id, text) =>
  call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});

export const removeButtons = (chatId, messageId) =>
  call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
