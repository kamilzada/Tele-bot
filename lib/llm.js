import { config } from './config.js';

// ---------- Gemini (scoring, keywords, and fallback drafting) ----------
export async function gemini(prompt, { system, json = false, temperature = 0.2 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${data.error?.message ?? 'unknown'}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Gemini returned an empty response');
  return json ? parseJson(text) : text.trim();
}

// ---------- Gemini (voice note transcription) ----------
export async function transcribe(audio, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audio.toString('base64') } },
          {
            text:
              'Transcribe this voice note from a skincare founder. Write exactly what she says, in her words. ' +
              'Remove only filler sounds (um, uh, like-as-filler) and false starts. Keep numbers, ingredient names, ' +
              'percentages and pH values exactly as spoken, written as digits (e.g. "10%", "pH 4.2"). ' +
              'Do not summarise, add, or interpret anything. If the audio is silent or unintelligible, reply with exactly: [inaudible]. ' +
              'Output only the transcript.',
          },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini transcription error ${res.status}: ${data.error?.message ?? 'unknown'}`);
  return (data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim();
}

// ---------- Claude (drafting) ----------
export async function claude(prompt, { system, maxTokens = 2000 } = {}) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.claudeModel,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${data.error?.message ?? 'unknown'}`);
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// Drafting uses Claude when a key is present, otherwise Gemini.
export const draftingModel = () => (config.anthropicKey ? `Claude (${config.claudeModel})` : `Gemini (${config.geminiModel})`);

export function writeDraft(prompt, system) {
  return config.anthropicKey
    ? claude(prompt, { system })
    : gemini(prompt, { system, temperature: 0.7 });
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Could not parse JSON from model: ${text.slice(0, 200)}`);
  }
}
