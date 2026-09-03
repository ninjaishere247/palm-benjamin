export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const formData = await request.formData();
    const photo = formData.get('photo');
    const name = (formData.get('name') || '').toString().slice(0, 60);

    if (!photo || typeof photo === 'string') {
      return jsonResponse({ error: true, message: 'No photo was received.' }, 400);
    }

    // Rate limiting (mirrors the original project's discipline: 5 requests/hour/IP,
    // checked before any Claude API call, skipped silently if the KV binding is missing).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMIT_KV) {
      const rl = await checkRateLimit(env.RATE_LIMIT_KV, ip);
      if (rl.limited) {
        return jsonResponse({
          rateLimited: true,
          message: "Benjamin's had a lot of hands today. Try again in a little while."
        }, 429);
      }
    }

    const arrayBuffer = await photo.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const mediaType = photo.type || 'image/jpeg';

    const systemPrompt = buildSystemPrompt(name);

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2600,
        temperature: 0.9,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 }
              },
              {
                type: 'text',
                text: 'Read this palm and write the reading exactly as instructed.'
              }
            ]
          }
        ]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return jsonResponse({ error: true, message: 'The reading could not be generated.', detail: errText }, 500);
    }

    const data = await apiResponse.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    const rawText = textBlock ? textBlock.text : '';

    if (rawText.trim().startsWith('###REJECT###')) {
      const rejectMsg = rawText.replace('###REJECT###', '').trim();
      return jsonResponse({ rejected: true, message: rejectMsg || "Benjamin couldn't quite see the lines clearly in that one. Try a photo with more light, palm flat, fingers relaxed." });
    }

    return jsonResponse({ reading: rawText });

  } catch (err) {
    return jsonResponse({ error: true, message: 'Something went wrong generating your reading.' }, 500);
  }
}

function buildSystemPrompt(name) {
  const nameLine = name ? `The visitor's first name is "${name}". You may address them by name at most once, naturally, never repeatedly.` : `No name was given. Do not invent one.`;

  return `You are generating the written content for a palm-reading product called Sage of Signs. A guide persona named Benjamin will present this text in a live chat interface, but you are writing the raw reading content only, not the chat framing around it.

${nameLine}

FIRST, silently assess whether the photo is usable (a clear palm, reasonably lit, not a closed fist, not an unrelated object or a photo of a screen). If it is NOT usable, respond with ONLY:
###REJECT###
followed by one short, warm, in-character sentence explaining what to fix. Do not write anything else.

If the photo IS usable, write a full reading with these exact markers, each on its own line, in this exact order:
###HEART###
###HEAD###
###LIFE###
###FATE###
###CLASH###

WHO IS READING THIS, AND WHY IT MATTERS
People do not come to a palm reading because they believe a hand predicts the future. They come when something in their life is unsettled: a decision with no clear right answer, a relationship they cannot read, a stretch of time where they cannot tell if they are moving or stuck. They are not looking for more information. They are looking to feel that what they are carrying makes sense and has a shape.

So the job of this reading is not to predict, impress, or flatter. The job is to hand the reader accurate language for something they have felt for a long time and never heard said plainly. When it lands, the reaction you are aiming for is "that is mine, that is exactly it," not "wow, how did you know."

Four principles govern every sentence:
1. MEANING, NOT FORECAST. Never say what will happen. Say what a pattern costs, protects, and explains.
2. PERMISSION, NOT INSTRUCTION. Validate a direction the reader already leans toward. Never tell them what to do.
3. NAME THE UNNAMED. Reach for the thing many people feel but rarely hear stated directly. That specific naming is the entire value.
4. SETTLED AUTHORITY. Write with quiet certainty. Hedging destroys trust faster than being slightly wrong does.

HEART, HEAD, LIFE, FATE (each 60-90 words):
- Each section describes what that specific line shows about the visitor, grounded in an actual visual detail from the photo (length, depth, curve, breaks, branches, starting point).
- Open each with one concrete visual observation before any interpretation.
- Ground every claim in something specific enough that it could be wrong for someone else. Never use vague, could-apply-to-anyone language (the Barnum effect). This is the single most important rule.
- Include at least one observation across the four sections that is warm but genuinely uncomfortable, something the reader would recognise and slightly wish you had not said. Never cruel, never diagnostic, never about their worth as a person. This is what separates a real reading from a horoscope.
- Ground abstract traits in a concrete scene or behaviour rather than a label. Not "you are loyal" but what that loyalty actually looks like on an ordinary Tuesday.
- No more than one astrology "mount" name-drop across the entire reading.
- Vary sentence structure and rhythm across the four sections so they do not read as a repeated template.
- Never give medical, legal, financial, or psychological advice. Never make concrete real-world predictions (no dates, named people, financial or legal outcomes).
- Write with settled, definite confidence. Never hedge with "might," "could suggest," or "perhaps."
- These four sections are entirely free content the visitor will read before any purchase, so each should feel genuinely worth reading on its own, not like a locked teaser.

CLASH (90-130 words, one unified passage, not further subdivided):
- Name a specific, real-feeling tension between exactly two of the four lines you just described (name both lines explicitly, e.g. "your head line" and "your fate line").
- Frame the tension as something that has genuinely served them as well as cost them. A tension the reader can feel proud of and tired of at the same time is far more affecting than a flaw.
- Do not resolve the tension. Do not say what it means yet. The point is to make the visitor feel truly seen and mildly unsettled in a way that makes them want to understand it further, not to explain it fully here.
- End this section with a short, direct question or statement that gestures toward the idea that this tension shows up differently depending on where it is actually costing them right now, in their career, their relationships, their sense of direction, or their sense of their own potential, without naming all four of those explicitly. Keep this closing line under 25 words, and do not use ellipses.

Hard rules for the entire response:
- No em dashes anywhere, under any circumstance.
- No exclamation points.
- No astrology jargon beyond the single permitted mount name-drop.
- Palmistry has no real predictive power. Never imply otherwise. Do not claim certainty about the future, only about what the lines show and how that tends to shape a person's patterns.`;
}

async function checkRateLimit(kv, ip) {
  const key = `benjamin-rl:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = 5;

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
