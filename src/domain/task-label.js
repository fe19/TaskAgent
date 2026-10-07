/** Turns a prompt into a 3–5 word tile label. Deterministic; never invents casing. */

/** Stripped from the front, longest first, repeatedly. */
const LEAD_FILLER = [
  'i would like you to',
  'i would like to',
  'your task is to',
  'your job is to',
  'i want you to',
  'i need you to',
  'can you please',
  'could you please',
  'please can you',
  'would you please',
  'i want to',
  'i need to',
  'can you',
  'could you',
  'would you',
  'what are',
  "what's",
  'what is',
  'whats',
  'tell me',
  'give me',
  'show me',
  'help me',
  'i want',
  'i need',
  'please',
  'kindly',
  'prompt:',
  'task:',
  'todo:',
];

/** Dropped anywhere — they cost a word and carry no meaning at this length. */
const NOISE_WORDS = new Set(['the', 'a', 'an']);

/** Clause boundaries, cut once the label has CLAUSE_CUT_MIN words. `of` is omitted on purpose. */
const CLAUSE_STARTERS = new Set([
  'about', 'after', 'and', 'as', 'at', 'because', 'before', 'but', 'by',
  'containing', 'during', 'for', 'from', 'if', 'in', 'into', 'like', 'named',
  'on', 'onto', 'or', 'since', 'so', 'than', 'that', 'then', 'to', 'under',
  'until', 'using', 'via', 'when', 'where', 'which', 'while', 'who', 'with',
  'within', 'without',
]);

// Cutting at 3 words would merge "cities from the us" and "... from the uk".
const CLAUSE_CUT_MIN = 4;
const MAX_WORDS = 5;
const MAX_CHARS = 42;

/** First line, first sentence. A dot only ends a sentence before whitespace, so
 *  filenames like `notes.md` survive intact. */
function firstClause(text) {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const match = line.match(/^(.*?)[.?!](?:\s|$)/s);
  return (match ? match[1] : line).trim();
}

function stripFiller(text) {
  let out = text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const lower = out.toLowerCase();
    for (const filler of LEAD_FILLER) {
      if (lower.startsWith(filler) && /[\s]|$/.test(lower.slice(filler.length, filler.length + 1))) {
        out = out.slice(filler.length).trim();
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function shortLabel(prompt, fallback = '') {
  const source = typeof prompt === 'string' ? prompt : '';
  const words = stripFiller(firstClause(source))
    .split(/\s+/)
    // Keep inner punctuation (file.txt, multi-word) but drop wrapping quotes/commas.
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 0 && !NOISE_WORDS.has(w.toLowerCase()));

  const picked = [];
  for (const word of words) {
    if (picked.length >= MAX_WORDS) break;
    if (picked.length >= CLAUSE_CUT_MIN && CLAUSE_STARTERS.has(word.toLowerCase())) break;
    picked.push(word);
  }
  // Truncating mid-clause can leave the label hanging on a connector word.
  while (picked.length > 2 && CLAUSE_STARTERS.has(picked.at(-1).toLowerCase())) picked.pop();

  let label = picked.join(' ');
  if (!label) {
    const raw = (fallback || source).trim().split(/\s+/).slice(0, MAX_WORDS).join(' ');
    label = raw;
  }
  if (label.length > MAX_CHARS) {
    const cut = label.slice(0, MAX_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    label = `${(lastSpace > MAX_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}
