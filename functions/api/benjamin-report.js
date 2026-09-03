export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const formData = await request.formData();
    const category = (formData.get('category') || '').toString();
    const reading = (formData.get('reading') || '').toString();
    const name = (formData.get('name') || '').toString().slice(0, 60);
    const mcAnswer = (formData.get('mcAnswer') || '').toString();
    let checkins = {};
    try { checkins = JSON.parse(formData.get('checkins') || '{}'); } catch {}

    const photo = formData.get('photo');
    const photo2 = formData.get('photo2');

    const categoryLabels = {
      career: 'Career and Finances',
      love: 'Love and Relationships',
      life: 'Life Path and Timing',
      traits: 'Inherent Traits and Potential'
    };
    const categoryLabel = categoryLabels[category];

    if (!category || !categoryLabel || !reading || !photo || typeof photo === 'string') {
      return jsonResponse({ error: true, message: 'Missing information needed to write this report.' }, 400);
    }
    if (category === 'traits' && (!photo2 || typeof photo2 === 'string')) {
      return jsonResponse({ error: true, message: 'This report needs a photo of your other hand.' }, 400);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const rl = await checkRateLimit(env.RATE_LIMIT_KV, ip);
      if (rl.limited) {
        return jsonResponse({ rateLimited: true, message: "Give it a little while and try again." }, 429);
      }
    }

    const imageBlocks = [];
    const buf1 = await photo.arrayBuffer();
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: photo.type || 'image/jpeg', data: arrayBufferToBase64(buf1) }
    });
    if (category === 'traits') {
      const buf2 = await photo2.arrayBuffer();
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: photo2.type || 'image/jpeg', data: arrayBufferToBase64(buf2) }
      });
    }

    const systemPrompt = buildSystemPrompt({ categoryLabel, category, reading, checkins, mcAnswer, name });

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3600,
        temperature: 0.85,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              ...imageBlocks,
              { type: 'text', text: category === 'traits'
                ? 'The first image is their dominant hand, already read once. The second image is their non-dominant hand. Write the full report exactly as instructed.'
                : 'Write the full report exactly as instructed, looking closely at the photo again for detail beyond the free reading.' }
            ]
          }
        ]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return jsonResponse({ error: true, message: 'The report could not be generated.', detail: errText }, 500);
    }

    const data = await apiResponse.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    const rawText = textBlock ? textBlock.text : '';

    if (rawText.trim().startsWith('###REJECT###')) {
      const rejectMsg = rawText.replace('###REJECT###', '').trim();
      return jsonResponse({ rejected: true, message: rejectMsg || "Benjamin couldn't get a clear read on that photo. Please try a clearer one." });
    }

    return jsonResponse({ report: rawText, category });

  } catch (err) {
    return jsonResponse({ error: true, message: 'Something went wrong generating this report.' }, 500);
  }
}

function buildSystemPrompt({ categoryLabel, category, reading, checkins, mcAnswer, name }) {
  const nameLine = name ? `Address them by name at most once, naturally.` : `No name was given, do not invent one.`;
  const checkinsSummary = JSON.stringify(checkins || {});

  const traitsNote = category === 'traits'
    ? `\nThis category specifically compares their dominant hand (already read once, in the free reading below) against their non-dominant hand (the second image). Ground THE TENSION and THE OPENING sections in a real, specific difference you can see between the two hands, not a generic statement about dominant versus non-dominant hands in general.`
    : '';

  const rejectCheck = category === 'traits'
    ? `\nFIRST, silently check the second image (their non-dominant hand). If it is NOT a usable, clear photo of an actual palm (a closed fist, a blurry or dark image, an unrelated object, a photo of a screen, or anything else that is not a readable palm), respond with ONLY:
###REJECT###
followed by one short, warm, in-character sentence asking specifically for a clearer photo of their other hand. Do not write anything else. Do not proceed to write the report if you reject.

If the second image IS usable, continue normally.\n`
    : '';

  return `You are Benjamin, an AI palm reader, writing the full paid report a visitor purchased after a free reading and a short sales page. They chose to go deeper into: ${categoryLabel}.
${rejectCheck}
Their original free reading, for context only, do not repeat it:
---
${reading}
---

Their check-in answers during the free reading: ${checkinsSummary}
Their answer about ${categoryLabel} specifically: "${mcAnswer}"
${nameLine}${traitsNote}

Write the report with exactly these seven markers, each on its own line, in this order. Each section is at most 300 words:
###PATTERN###
###ORIGIN###
###TENSION###
###COST###
###OPENING###
###PHASE###
###WATCH###

THE PATTERN: One concrete, specific observation from their hand relevant to ${categoryLabel}. Open with a visual detail, not a label.
THE ORIGIN: The mechanism behind that pattern. Why it shows up this way for them specifically, grounded in the hand, not generic psychology.
THE TENSION: A genuine trade-off or contradiction in their hand relevant to this area. Something that has both served and cost them.
THE COST: What staying exactly as they are is quietly costing them right now, specifically in ${categoryLabel}, not in general.
THE OPENING: Reframe a perceived weakness as a misapplied strength, or the reverse, and what becomes possible if they see it differently.
THE PHASE: What stage or chapter they appear to be in right now, without naming dates or predicting outcomes.
WATCH: Two or three specific, observable things to notice in themselves this week. Concrete, not vague.

Hard rules for the entire response:
- No em dashes anywhere, under any circumstance.
- No exclamation points.
- Never use vague, Barnum-style language that could apply to anyone. Every claim should be specific enough that it could be wrong for someone else.
- Never give medical, legal, financial, or psychological advice, and never make concrete real-world predictions (no dates, named people, financial or legal outcomes).
- Palmistry has no real predictive power. Never imply otherwise.
- Write with settled, definite confidence. Never hedge.`;
}

async function checkRateLimit(kv, ip) {
  const key = `benjamin-report-rl:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = 10;

  let record;
  try {
    const existing = await kv.get(key);
    record = existing ? JSON.parse(existing) : null;
  } catch {
    record = null;
  }

  if (!record || (now - record.windowStart) > windowMs) {
    record = { windowStart: now, count: 1 };
    await kv.put(key, JSON.stringify(record), { expirationTtl: 3600 });
    return { limited: false };
  }

  if (record.count >= limit) {
    return { limited: true };
  }

  record.count += 1;
  await kv.put(key, JSON.stringify(record), { expirationTtl: 3600 });
  return { limited: false };
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
