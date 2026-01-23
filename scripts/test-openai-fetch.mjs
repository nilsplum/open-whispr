// Minimal network sanity check for OpenAI HTTPS from Node.
// Usage:
//   OPENAI_API_KEY=... node scripts/test-openai-fetch.mjs
// Optional:
//   OPENAI_BASE_URL=https://api.openai.com/v1

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Missing OPENAI_API_KEY env var.');
  process.exit(2);
}

const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const url = `${base}/models`;

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000);

try {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: controller.signal,
  });

  const text = await res.text();
  console.log('URL:', url);
  console.log('Status:', res.status, res.statusText);
  console.log('Body (first 400 chars):', text.slice(0, 400));

  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error('Fetch failed:', err?.name || 'Error', err?.message || err);
  process.exit(3);
} finally {
  clearTimeout(timeout);
}
