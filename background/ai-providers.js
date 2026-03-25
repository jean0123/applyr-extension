/**
 * Applyr – AI Provider Adapters
 * Handles API calls to Claude (Anthropic), ChatGPT (OpenAI), and Gemini (Google).
 * Loaded by background.js via importScripts.
 */

(function () {
  'use strict';

  // ---------- Rate limiting ----------

  const rateLimiters = {};

  function getRateLimiter(provider) {
    if (!rateLimiters[provider]) {
      rateLimiters[provider] = {
        lastRequest: 0,
        minInterval: 1000, // 1 second between requests
        retryAfter: 0,
      };
    }
    return rateLimiters[provider];
  }

  async function waitForRateLimit(provider) {
    const rl = getRateLimiter(provider);
    const now = Date.now();

    if (rl.retryAfter > now) {
      const waitMs = rl.retryAfter - now;
      await sleep(waitMs);
    }

    const elapsed = now - rl.lastRequest;
    if (elapsed < rl.minInterval) {
      await sleep(rl.minInterval - elapsed);
    }

    rl.lastRequest = Date.now();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function handleRateLimitResponse(provider, response) {
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
      getRateLimiter(provider).retryAfter = Date.now() + waitMs;
      throw new Error(`Rate limit hit for ${provider}. Please wait ${Math.ceil(waitMs / 1000)} seconds.`);
    }
  }

  // ---------- Claude (Anthropic) ----------

  async function callClaude(apiKey, systemPrompt, userMessage) {
    await waitForRateLimit('claude');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    handleRateLimitResponse('claude', response);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Claude API error (${response.status}): ${error.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    if (!data.content || !data.content[0]) {
      throw new Error('Claude returned an empty response.');
    }

    return data.content[0].text;
  }

  // ---------- OpenAI (ChatGPT) ----------

  async function callOpenAI(apiKey, systemPrompt, userMessage) {
    await waitForRateLimit('openai');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
      }),
    });

    handleRateLimitResponse('openai', response);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error (${response.status}): ${error.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0]) {
      throw new Error('OpenAI returned an empty response.');
    }

    return data.choices[0].message.content;
  }

  // ---------- Gemini (Google) ----------

  async function callGemini(apiKey, systemPrompt, userMessage) {
    await waitForRateLimit('gemini');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userMessage }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.3,
        },
      }),
    });

    handleRateLimitResponse('gemini', response);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Gemini API error (${response.status}): ${error.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error('Gemini returned an empty response.');
    }

    return candidate.content.parts[0].text;
  }

  // ---------- Unified call interface ----------

  async function callAI(provider, apiKey, systemPrompt, userMessage) {
    switch (provider) {
      case 'claude':
        return callClaude(apiKey, systemPrompt, userMessage);
      case 'openai':
        return callOpenAI(apiKey, systemPrompt, userMessage);
      case 'gemini':
        return callGemini(apiKey, systemPrompt, userMessage);
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  }

  // Public API
  const ApplyrAiProviders = {
    callAI,
    callClaude,
    callOpenAI,
    callGemini,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.ApplyrAiProviders = ApplyrAiProviders;
  }
})();
