import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableGeminiError,
  parseGeminiJson,
  runWithConcurrency,
  withExponentialBackoff,
} from './pipelineResilience';

test('isRetryableGeminiError classifies transient vs fatal errors accurately', () => {
  assert.equal(isRetryableGeminiError(new Error('503 UNAVAILABLE high demand')), true);
  assert.equal(isRetryableGeminiError(new Error('429 RESOURCE_EXHAUSTED')), true);
  assert.equal(isRetryableGeminiError(new Error('Request timeout after 45000ms')), true);
  assert.equal(isRetryableGeminiError(new Error('403 PERMISSION_DENIED')), false);
  assert.equal(isRetryableGeminiError(new Error('400 INVALID_ARGUMENT')), false);
  assert.equal(isRetryableGeminiError(new Error('404 NOT_FOUND')), false);
});

test('parseGeminiJson extracts raw, fenced, and prose-wrapped JSON payloads', () => {
  assert.deepEqual(parseGeminiJson('{"ok":true,"count":3}', { ok: false, count: 0 }), {
    ok: true,
    count: 3,
  });

  const fenced = '```json\n[{"id":"seg-1","text":"Hello"}]\n```';
  assert.deepEqual(parseGeminiJson(fenced, []), [{ id: 'seg-1', text: 'Hello' }]);

  const wrapped = 'Here is the extracted transcript:\n[{"start":0,"end":4}]\nThank you.';
  assert.deepEqual(parseGeminiJson(wrapped, []), [{ start: 0, end: 4 }]);

  assert.deepEqual(parseGeminiJson('not valid json at all', { fallback: true }), { fallback: true });
  assert.deepEqual(parseGeminiJson(null, ['default']), ['default']);
});

test('runWithConcurrency bounds parallel workers and preserves result order', async () => {
  let active = 0;
  let maxObserved = 0;
  const inputs = [10, 20, 30, 40, 50, 60];

  const outputs = await runWithConcurrency(inputs, 2, async (value, idx) => {
    active += 1;
    maxObserved = Math.max(maxObserved, active);
    await new Promise((r) => setTimeout(r, (6 - idx) * 5));
    active -= 1;
    return value * 2;
  });

  assert.ok(maxObserved <= 2, `Expected max concurrency <= 2, got ${maxObserved}`);
  assert.deepEqual(outputs, [20, 40, 60, 80, 100, 120]);
});

test('withExponentialBackoff retries transient errors and fails fast on non-retryable errors', async () => {
  let transientAttempts = 0;
  const result = await withExponentialBackoff(
    async () => {
      transientAttempts += 1;
      if (transientAttempts < 3) {
        throw new Error('503 UNAVAILABLE');
      }
      return 'recovered';
    },
    { maxAttempts: 4, baseDelayMs: 50 }
  );
  assert.equal(result, 'recovered');
  assert.equal(transientAttempts, 3);

  let fatalAttempts = 0;
  await assert.rejects(
    () =>
      withExponentialBackoff(
        async () => {
          fatalAttempts += 1;
          throw new Error('403 PERMISSION_DENIED');
        },
        { maxAttempts: 4, baseDelayMs: 50 }
      ),
    /403 PERMISSION_DENIED/
  );
  assert.equal(fatalAttempts, 1);
});
