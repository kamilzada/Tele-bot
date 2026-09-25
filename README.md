# Meera Content Bot

Meera drops a note into Telegram, typed or as a voice note. Voice notes are transcribed by Gemini and the transcript is sent back so she can see what it heard. Then the bot:

1. **Scores it 0–10** (Gemini Flash) with a one-line reason.
   - **Below 6:** replies with the score and why. No draft is made.
   - **6 or above:** continues.
2. **Finds a news angle.** Gemini turns the note into a search phrase and pulls the top 3 Google News results from the last 30 days. No key needed.
3. **Drafts a LinkedIn post in Meera's voice.** Claude writes it if `ANTHROPIC_API_KEY` is set, otherwise Gemini does. The model gets the full `voice-skill.txt` every time.
4. **Adds the verify flag.** Any draft that uses a news item ends with the source, date, link and a "check this before publishing" warning.
5. **Waits for Meera.** She taps Approve/Reject, or replies APPROVE/REJECT. **Nothing is ever posted to LinkedIn automatically.** That's "the Cut" (Check 07, Judgment Protected).

```
Telegram note ─► api/webhook.js
                   ├─ lib/pipeline.js  scoreNote()  ── Gemini Flash ── < 6 ? reply & stop
                   ├─ lib/pipeline.js  findNews()   ── Gemini + Google News RSS
                   ├─ lib/pipeline.js  draftPost()  ── Claude / Gemini + voice-skill.txt
                   ├─ lib/store.js     (Supabase: notes, drafts — optional)
                   └─ lib/telegram.js  draft + verify flag + Approve/Reject buttons
```

## Files

| File | What it does |
|---|---|
| `api/webhook.js` | Receives every Telegram message. Routes notes, /start, and APPROVE/REJECT |
| `lib/pipeline.js` | The score → news → draft → send steps |
| `lib/prompts.js` | The scoring rubric and drafting instructions. **Loads `voice-skill.txt` here** (`VOICE_SKILL`, used in `DRAFT_SYSTEM`) |
| `voice-skill.txt` | Meera's voice spec. Edit this file to tune her tone |
| `lib/llm.js` | Gemini and Claude API calls |
| `lib/news.js` | Google News RSS search |
| `lib/store.js` | Supabase save/update. Skipped entirely if not configured |
| `supabase/schema.sql` | Tables for notes, drafts and voice_skill |

## Setup

### 1. Keys
Copy the values into `.env` (for reference) and into **Vercel → Project → Settings → Environment Variables** (this is the copy that's actually used):

- `TELEGRAM_BOT_TOKEN`: from @BotFather
- `GEMINI_API_KEY`: from https://aistudio.google.com/apikey
- `ANTHROPIC_API_KEY`: from https://console.anthropic.com (recommended, for drafting)
- Optional: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ALLOWED_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `MIN_SCORE`

`.env` is in `.gitignore`. Never push it to GitHub.

### 2. Supabase (optional, for memory + APPROVE/REJECT)
Create a project, open **SQL Editor**, paste `supabase/schema.sql`, and click Run.

### 3. Deploy
Push this folder to GitHub → Vercel → **Add New Project** → import the repo → add the env vars → **Deploy**.

### 4. Connect Telegram
Open this URL in a browser, with your own values filled in:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook
```

If you set `TELEGRAM_WEBHOOK_SECRET`, add `&secret_token=<that value>` to the end. You should see `"ok":true`.

### 5. Lock it to Meera
Send `/start` to the bot. It replies with your chat ID. Put that ID in `ALLOWED_CHAT_IDS` on Vercel and redeploy, so nobody else can spend your API credits.

**Using a channel instead of a direct chat?** Add the bot to the channel as an admin with "Post messages" permission. It reads channel posts and replies in the same channel.

## Testing (B1 checkpoint)

- **Strong note:** should score 6+ and come back as a draft.
  > *"Customer DM today: she bought a 10% niacinamide serum from a big brand, got redness in a week. Checked the pH on their site, 4.2. At that pH niacinamide partially converts to nicotinic acid, which is what causes flushing. The percentage wasn't the problem. The pH was."*
- **Weak note:** should score 3 or below, with no draft.
  > *"call packaging vendor re: pump caps thurs"*

If every note passes, the scoring rubric in `lib/prompts.js` (`SCORING_SYSTEM`) is too lenient. Tighten it.

## Troubleshooting

- **No reply at all:** open `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and check `last_error_message`. Also check the Vercel logs (Project → Logs).
- **"Something went wrong… Gemini error 404":** the model name has changed. Set `GEMINI_MODEL` to a current Flash model.
- **Draft sounds generic:** confirm `voice-skill.txt` is in the deployed project. `vercel.json` includes it with the function.
