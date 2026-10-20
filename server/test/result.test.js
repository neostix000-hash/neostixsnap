import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import {
  buildOutputJsonSchema,
  normalizeResult,
  parseModelJson
} from '../src/result.js';

test('parseModelJson accepts fenced JSON and surrounding prose', () => {
  const raw = 'Here is the result:\n```json\n{"status":"answered","answer":"42"}\n```\nDone.';
  assert.deepEqual(parseModelJson(raw), { status: 'answered', answer: '42' });
});

test('parseModelJson unwraps a result property', () => {
  const parsed = parseModelJson('{"result":{"status":"answered","answer":"x"}}');
  assert.equal(parsed.answer, 'x');
});

test('parseModelJson rejects non-JSON output', () => {
  assert.throws(
    () => parseModelJson('I cannot answer that.'),
    (error) => error instanceof AppError && error.code === 'ai_invalid_output'
  );
});

test('normalizeResult produces a clean answered result', () => {
  const result = normalizeResult({
    status: 'answered',
    subject: ' Mathematics ',
    language: 'cs',
    recognized_question: '  Vypočítej 2 + 2. ',
    answer: ' 4 ',
    steps: ['Sečti čísla.', ' ', 'Výsledek je 4.'],
    items: [],
    clarification: ' ',
    warning: null,
    confidence: 1.7
  });
  assert.equal(result.status, 'answered');
  assert.equal(result.subject, 'Mathematics');
  assert.equal(result.recognized_question, 'Vypočítej 2 + 2.');
  assert.equal(result.answer, '4');
  assert.deepEqual(result.steps, ['Sečti čísla.', 'Výsledek je 4.']);
  assert.equal(result.clarification, null);
  assert.equal(result.confidence, 1);
});

test('normalizeResult handles multiple exercises', () => {
  const result = normalizeResult({
    status: 'answered',
    recognized_question: '1. ...\n2. ...',
    answer: '',
    items: [
      { question: '1. 2+2', answer: '4', steps: [] },
      { question: '2. 3+3', answer: '6', steps: ['Sečti.'] }
    ],
    confidence: 0.9
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].answer, '6');
});

test('an answered result without any answer is rejected', () => {
  assert.throws(
    () =>
      normalizeResult({
        status: 'answered',
        recognized_question: 'Unknown',
        answer: '',
        items: []
      }),
    (error) => error instanceof AppError && error.code === 'ai_invalid_output'
  );
});

test('a clarification result gets a helpful fallback message', () => {
  const result = normalizeResult({
    status: 'needs_clarification',
    recognized_question: '...',
    answer: ''
  });
  assert.match(result.clarification, /capture/i);
  assert.equal(result.answer, '');
});

test('the strict output schema requires every field', () => {
  const schema = buildOutputJsonSchema();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    new Set(schema.required),
    new Set([
      'status',
      'subject',
      'language',
      'recognized_question',
      'answer',
      'steps',
      'items',
      'clarification',
      'warning',
      'confidence'
    ])
  );
});
