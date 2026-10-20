import { AppError } from './errors.js';

const STATUSES = new Set(['answered', 'needs_clarification', 'unsupported']);
const MAX_STEPS = 20;
const MAX_ITEMS = 12;

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

function cleanSubject(value) {
  return cleanString(value, 60).replace(/\s+/g, ' ');
}

function cleanSteps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((step) => cleanString(step, 2200))
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

function extractBalancedJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function parseModelJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new AppError('ai_invalid_output', 'The AI returned an empty response.', 502);
  }
  const text = rawText.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text);
  const balanced = extractBalancedJson(text);
  if (balanced) candidates.push(balanced);

  for (const candidate of new Set(candidates)) {
    try {
      let parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length === 1) parsed = parsed[0];
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      if (parsed.result && typeof parsed.result === 'object' && !parsed.answer) {
        parsed = parsed.result;
      }
      return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  throw new AppError(
    'ai_invalid_output',
    'The AI response could not be read. Please regenerate the answer.',
    502
  );
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ITEMS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const question = cleanString(item.question, 5000);
      const answer = cleanString(item.answer, 8000);
      const steps = cleanSteps(item.steps);
      if (!question && !answer) return null;
      return { question, answer, steps };
    })
    .filter(Boolean);
}

export function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('ai_invalid_output', 'The AI response had an unexpected shape.', 502);
  }

  let status = cleanString(raw.status, 40).toLowerCase().replace(/\s+/g, '_');
  const answer = cleanString(raw.answer, 14000);
  const steps = cleanSteps(raw.steps);
  const items = normalizeItems(raw.items);
  const recognizedQuestion = cleanString(raw.recognized_question ?? raw.question, 14000);
  const clarification = cleanString(raw.clarification, 4000) || null;
  const warning = cleanString(raw.warning, 2000) || null;
  const subject = cleanSubject(raw.subject) || 'General';
  const language = cleanString(raw.language, 40) || 'unknown';

  let confidence = null;
  if (typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)) {
    confidence = Math.max(0, Math.min(1, raw.confidence));
  } else if (typeof raw.confidence === 'string' && /^\d*\.?\d+$/.test(raw.confidence.trim())) {
    confidence = Math.max(0, Math.min(1, Number(raw.confidence)));
  }

  if (!STATUSES.has(status)) {
    status = answer || items.some((item) => item.answer) ? 'answered' : 'needs_clarification';
  }

  const answersInItems = items.filter((item) => item.answer).length;
  if (status === 'answered' && !answer && answersInItems === 0) {
    throw new AppError('ai_invalid_output', 'The AI did not return an answer.', 502);
  }

  if (status === 'needs_clarification' && !clarification) {
    return {
      status,
      subject,
      language,
      recognized_question: recognizedQuestion,
      answer: '',
      steps: [],
      items,
      clarification:
        'I could not read the exercise clearly. Please capture it again, closer and in focus.',
      warning,
      confidence
    };
  }

  if (status === 'unsupported' && !clarification && !answer) {
    return {
      status,
      subject,
      language,
      recognized_question: recognizedQuestion,
      answer: '',
      steps: [],
      items,
      clarification:
        'This does not look like a school exercise NeostixSnap can solve. Try capturing the task itself.',
      warning,
      confidence
    };
  }

  return {
    status,
    subject,
    language,
    recognized_question: recognizedQuestion,
    answer,
    steps,
    items,
    clarification,
    warning,
    confidence
  };
}

export function buildOutputJsonSchema() {
  const stringArray = {
    type: 'array',
    items: { type: 'string' },
    maxItems: MAX_STEPS
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
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
    ],
    properties: {
      status: {
        type: 'string',
        enum: ['answered', 'needs_clarification', 'unsupported']
      },
      subject: { type: 'string' },
      language: { type: 'string' },
      recognized_question: { type: 'string' },
      answer: { type: 'string' },
      steps: stringArray,
      items: {
        type: 'array',
        maxItems: MAX_ITEMS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'answer', 'steps'],
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
            steps: stringArray
          }
        }
      },
      clarification: { type: ['string', 'null'] },
      warning: { type: ['string', 'null'] },
      confidence: { type: ['number', 'null'] }
    }
  };
}

export const RESULT_SCHEMA_NAME = 'neostixsnap_answer';
