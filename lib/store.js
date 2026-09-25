// Supabase via its REST API (no SDK needed). Every function is a no-op
// when Supabase isn't configured, so the bot works without a database.
import { config, hasStore } from './config.js';

async function rest(method, table, { query = '', body } = {}) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${table} failed: ${data?.message ?? res.status}`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

// Returns the saved note, or null if this Telegram update was already processed
// (Telegram re-sends updates when a webhook is slow or errors).
export async function saveNote({ chatId, updateId, text }) {
  if (!hasStore()) return { id: null };
  try {
    const [row] = await rest('POST', 'notes', {
      body: { chat_id: String(chatId), telegram_update_id: updateId, text },
    });
    return row;
  } catch (err) {
    if (err.code === '23505') return null; // unique violation -> duplicate update
    throw err;
  }
}

export async function updateNote(id, fields) {
  if (!hasStore() || !id) return;
  await rest('PATCH', 'notes', { query: `?id=eq.${id}`, body: fields });
}

export async function saveDraft(fields) {
  if (!hasStore()) return { id: null };
  const [row] = await rest('POST', 'drafts', { body: { status: 'pending', ...fields } });
  return row;
}

export async function setDraftMessageId(id, messageId) {
  if (!hasStore() || !id) return;
  await rest('PATCH', 'drafts', { query: `?id=eq.${id}`, body: { telegram_message_id: messageId } });
}

// Finds the draft to approve/reject: by id, by the Telegram message it was sent in,
// or (fallback) the most recent pending draft in this chat.
export async function findDraft({ id, chatId, messageId }) {
  if (!hasStore()) return null;
  let query;
  if (id) query = `?id=eq.${id}`;
  else if (messageId) query = `?chat_id=eq.${chatId}&telegram_message_id=eq.${messageId}`;
  else query = `?chat_id=eq.${chatId}&status=eq.pending&order=created_at.desc`;
  const rows = await rest('GET', 'drafts', { query: `${query}&limit=1` });
  return rows?.[0] ?? null;
}

export async function setDraftStatus(id, status) {
  if (!hasStore()) return;
  await rest('PATCH', 'drafts', {
    query: `?id=eq.${id}`,
    body: { status, reviewed_at: new Date().toISOString() },
  });
}
