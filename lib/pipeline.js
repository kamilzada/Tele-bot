import { config, hasStore } from './config.js';
import { gemini, writeDraft, draftingModel } from './llm.js';
import { searchNews } from './news.js';
import { SCORING_SYSTEM, scoringPrompt, keywordPrompt, DRAFT_SYSTEM, draftPrompt } from './prompts.js';
import * as store from './store.js';
import { sendMessage, sendTyping } from './telegram.js';

const LINE = '─────────────────────────────────';

// Step 1 — score 0-10 with a one-line reason (Gemini Flash: fast, cheap).
export async function scoreNote(note) {
  const result = await gemini(scoringPrompt(note), { system: SCORING_SYSTEM, json: true, temperature: 0 });
  const score = Math.max(0, Math.min(10, Math.round(Number(result.score))));
  if (Number.isNaN(score)) throw new Error(`Bad score from model: ${JSON.stringify(result)}`);
  return { score, reason: String(result.reason ?? '').trim() };
}

// Step 2 — find a news hook. Failures here never block the draft.
export async function findNews(note) {
  try {
    const { query } = await gemini(keywordPrompt(note), { json: true, temperature: 0 });
    if (!query) return { query: '', items: [] };
    return { query, items: await searchNews(query, 3) };
  } catch (err) {
    console.error('News lookup failed:', err.message);
    return { query: '', items: [] };
  }
}

// Step 3 — draft in Meera's voice (Claude if configured, else Gemini).
export async function draftPost(note, newsItems) {
  const raw = await writeDraft(draftPrompt(note, newsItems), DRAFT_SYSTEM);
  const match = raw.match(/\n?\s*NEWS_USED:\s*(\S+)\s*$/i);
  const post = (match ? raw.slice(0, match.index) : raw).trim();
  const idx = match ? parseInt(match[1], 10) : NaN;
  const news = Number.isInteger(idx) ? newsItems[idx - 1] ?? null : null;
  return { post, news };
}

// The verify flag is mandatory whenever a news item is used:
// Meera is the author of every claim that goes out under her name.
export function verifyFlag(news) {
  return [
    LINE,
    `NEWS SOURCE: ${news.headline}`,
    `FROM: ${news.source} · ${news.date}`,
    `LINK: ${news.link}`,
    '⚠ Check this before publishing — you are the author of this claim',
    LINE,
  ].join('\n');
}

// Full run for one incoming note.
export async function handleNote({ chatId, updateId, messageId, text }) {
  const saved = await store.saveNote({ chatId, updateId, text });
  if (saved === null) return; // duplicate delivery from Telegram — already handled

  await sendTyping(chatId);
  const { score, reason } = await scoreNote(text);
  await store.updateNote(saved.id, { score, score_reason: reason, status: score >= config.minScore ? 'drafted' : 'rejected' });

  if (score < config.minScore) {
    await sendMessage(
      chatId,
      `Score ${score}/10 — no draft made.\n${reason}\n\n(Notes need ${config.minScore}+ to be drafted. Add a specific number, scene, or mechanism and send it again.)`,
      { replyTo: messageId }
    );
    return;
  }

  await sendTyping(chatId);
  const { query, items } = await findNews(text);

  await sendTyping(chatId);
  const { post, news } = await draftPost(text, items);

  const draft = await store.saveDraft({
    note_id: saved.id,
    chat_id: String(chatId),
    content: post,
    model: draftingModel(),
    news_query: query || null,
    news_headline: news?.headline ?? null,
    news_source: news?.source ?? null,
    news_date: news?.date || null,
    news_url: news?.link ?? null,
  });

  const header = `Score ${score}/10 — ${reason}\nDRAFT (${draftingModel()}):`;
  const footer = hasStore()
    ? 'Tap a button below, or reply APPROVE / REJECT to this message.'
    : 'Copy, edit, and post it yourself when you are happy with it.';
  const message = [header, LINE, post, ...(news ? ['', verifyFlag(news)] : []), '', footer].join('\n');

  const buttons = hasStore() && draft.id
    ? [[
        { text: 'Approve', callback_data: `approve:${draft.id}` },
        { text: 'Reject', callback_data: `reject:${draft.id}` },
      ]]
    : undefined;

  const sent = await sendMessage(chatId, message, { buttons, replyTo: messageId });
  await store.setDraftMessageId(draft.id, sent.message_id);
}

// APPROVE / REJECT — nothing is ever published automatically. Approval only
// records Meera's decision; she posts to LinkedIn herself.
export async function handleReview({ chatId, status, draftId, replyToMessageId }) {
  if (!hasStore()) {
    await sendMessage(chatId, 'Review tracking needs Supabase configured (SUPABASE_URL and SUPABASE_SERVICE_KEY).');
    return null;
  }
  const draft = await store.findDraft({ id: draftId, chatId: String(chatId), messageId: replyToMessageId });
  if (!draft) {
    await sendMessage(chatId, 'No matching draft found. Reply APPROVE or REJECT directly to the draft message.');
    return null;
  }
  await store.setDraftStatus(draft.id, status);
  return draft;
}
