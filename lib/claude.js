/**
 * Claude API client for DeadlineOS.
 * Calls /api/claude proxy (local dev: serve.mjs, prod: Vercel serverless).
 */

const API_ENDPOINT = '/api/claude';

/**
 * Call Claude with a system prompt and user message.
 * @param {string} system
 * @param {string} userMessage
 * @param {{ onChunk?: (text: string) => void, apiKey?: string }} [opts]
 * @returns {Promise<string>} Full response text
 */
export async function callClaude(system, userMessage, opts = {}) {
  const { onChunk, apiKey } = opts;
  const stream = typeof onChunk === 'function';

  const body = JSON.stringify({
    system,
    messages: [{ role: 'user', content: userMessage }],
    stream,
    apiKey: apiKey || '',
  });

  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error ${res.status}: ${err}`);
    }

    if (stream) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const text = parsed?.delta?.text || parsed?.text || '';
              if (text) {
                fullText += text;
                onChunk(text);
              }
            } catch {
              // non-JSON SSE line, skip
            }
          }
        }
      }
      return fullText;
    } else {
      const data = await res.json();
      return data.text || data.content?.[0]?.text || '';
    }
  } catch (err) {
    console.error('Claude API failed:', err);
    throw err;
  }
}

/**
 * Mock response for when the Claude API is unavailable.
 * @param {string} type - 'conflict' | 'insight' | 'nudge'
 * @returns {string}
 */
export function getMockResponse(type) {
  const mocks = {
    conflict: `1. Prioritize your AP Calc problem set — it's due in 3 days and you've been avoiding it.
2. The AP Lang essay is your biggest time sink. Start it tonight, not "tomorrow."
3. Extend the US History reading if possible — email your teacher now.
4. AP Bio lab report can wait until Thursday if you start Calc today.
5. You have 22 hours of work crammed into 15 hours of capacity. Something has to give — choose intentionally.`,
    insight: `Your data this week is pretty clear: AP Lang destroyed your estimates by 1.8x average. You planned 4 hours, spent 7.2. That's not a bad week — that's a pattern.

Your procrastination score: 1.43. Meaning on average, you take 43% longer than you think.

One thing to do differently: when you estimate AP Lang assignments, multiply whatever you write by 1.8 before committing. Not as a punishment — as math.

Bright spot: US History was nearly perfect. You actually know how long reading takes. Transfer that honesty to your other subjects.`,
    nudge: `It's Wednesday and you have 4.5 hours of work queued — that AP Bio lab report isn't going to write itself at midnight like you're planning.`,
  };
  return mocks[type] || mocks.insight;
}
