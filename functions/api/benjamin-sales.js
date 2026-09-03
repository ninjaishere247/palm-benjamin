export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { category, reading, checkins, mcAnswer, name } = body;

    if (!category || !reading) {
      return jsonResponse({ error: true, message: 'Missing reading data.' }, 400);
    }

    const categoryLabels = {
      career: 'Career and Finances',
      love: 'Love and Relationships',
      life: 'Life Path and Timing',
      traits: 'Inherent Traits and Potential'
    };
    const categoryLabel = categoryLabels[category] || category;

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const rl = await checkRateLimit(env.RATE_LIMIT_KV, ip);
      if (rl.limited) {
        return jsonResponse({ rateLimited: true, message: "Give it a little while and try again." }, 429);
      }
    }

    const systemPrompt = buildSystemPrompt({ categoryLabel, reading, checkins, mcAnswer, name });

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        temperature: 0.85,
        system: systemPrompt,
        messages: [
          { role: 'user', content: 'Write the sales page exactly as instructed.' }
        ]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return jsonResponse({ error: true, message: 'The page could not be generated.', detail: errText }, 500);
    }

    const data = await apiResponse.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    const rawText = textBlock ? textBlock.text : '';

    return jsonResponse({ copy: rawText });

  } catch (err) {
    return jsonResponse({ error: true, message: 'Something went wrong generating the page.' }, 500);
  }
}

function buildSystemPrompt({ categoryLabel, reading, checkins, mcAnswer, name }) {
  const nameLine = name ? `Address them by name at most once, naturally.` : `No name was given, do not invent one.`;
  const checkinsSummary = checkins ? JSON.stringify(checkins) : 'none recorded';

  return `You are Benjamin, an AI palm reader, writing the sales page a visitor sees after receiving a free reading of their heart, head, life, and fate lines. They have chosen to go deeper into: ${categoryLabel}.

Here is their full free reading, which you already gave them. Do not repeat or re-explain it. You are continuing the conversation, not summarizing what already happened:
---
${reading}
---

Their answers to short check-in questions during the reading: ${checkinsSummary}
Their answer to the follow-up question about ${categoryLabel}: "${mcAnswer}"
${nameLine}

Write the sales page with exactly these three markers, each on its own line, in this order:
###HOOK###
###BODY###
###CLOSE###

HOOK (30-50 words):
Widen the unresolved tension you already named in the CLASH section of the reading. Do not restate it, extend it. Point specifically at how it shows up in ${categoryLabel}, using something concrete from their check-in answers or their MC answer. Do not resolve anything here. End on a genuine open question or an unfinished thought, not a statement.

BODY (500-650 words, can be multiple paragraphs):
Write in Benjamin's voice: warm, direct, settled, never hedging, never using vague statements that could apply to anyone. Ground everything in the specific reading and answers you were given. This section should:
- Name the real cost of the unresolved tension specifically as it plays out in ${categoryLabel}. Be concrete, not abstract.
- Acknowledge honestly what you do not yet know about them (you have their palm and a few short answers, nothing else). Do not fabricate testimonials, reviews, statistics, or claims about other customers.
- Explain plainly what the deeper reading actually does: it is not a prediction, it is a synthesis of what is already visible in their hand, written specifically for them, not a template.
- Do not use urgency, countdowns, or scarcity claims of any kind. Do not claim limited spots or limited time.
- No em dashes anywhere.

CLOSE (100-140 words):
Make the offer plainly: a deeper written reading focused on ${categoryLabel}, delivered as a short report, for $9. Mention that if they want, all four areas are available together for $24. Mention a plain, honest satisfaction guarantee: if it does not feel true to them, they can ask for their money back, no argument. End with one direct, warm sentence inviting them to continue, not a countdown or artificial urgency.

Hard rules for the entire response:
- No em dashes anywhere, under any circumstance.
- No exclamation points.
- Never claim palmistry predicts the future. Only that it reflects patterns already present.
- Never fabricate testimonials, reviews, user counts, or social proof of any kind.
- Never use scarcity or urgency language ("only X left", "today only", countdowns).
- Keep sentences direct. Avoid vague, Barnum-style statements that could apply to anyone.`;
}

async function checkRateLimit(kv, ip) {
  const key = `benjamin-sales-rl:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = 30;

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

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
