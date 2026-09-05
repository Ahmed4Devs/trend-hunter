import type {
  ClassificationResult,
  ClassifyRequest,
  EmbedOutput,
  EmbedRequest,
  GeneratedPost,
  GeneratedThread,
  GenerateRequest,
  LlmCallMeta,
  LlmProvider,
  LlmResult,
  SummarizeRequest,
  TranslateRequest,
  TranslationOutput,
} from '@trendhunter/types';

/**
 * A deterministic stand-in for `@trendhunter/ai`, which is written in parallel
 * with this package.
 *
 * It is a word-substitution pseudo-translator rather than a stub that echoes
 * its input, because the pipeline it is testing rejects output that is not in
 * the target script — an echoing stub would be caught by the very validation
 * these tests exist to exercise. Punctuation, digits, line breaks and anything
 * that looks like a protection placeholder pass through untouched, which is
 * exactly the behaviour a real provider is asked for and the behaviour the
 * terminology tests assert on.
 */

const DICTIONARY: Readonly<Record<string, string>> = {
  a: 'واحد',
  agents: 'الوكلاء',
  alpha: 'ألفا',
  and: 'و',
  are: 'هي',
  benchmark: 'مقياس',
  building: 'بناء',
  but: 'لكن',
  can: 'يمكن',
  charlie: 'تشارلي',
  conclusion: 'خلاصة',
  data: 'بيانات',
  delta: 'دلتا',
  developers: 'المطورون',
  echo: 'إيكو',
  every: 'كل',
  faster: 'أسرع',
  for: 'لأجل',
  foxtrot: 'فوكستروت',
  golf: 'غولف',
  hook: 'خطاف',
  in: 'في',
  is: 'هو',
  it: 'هو',
  measured: 'قِيس',
  model: 'نموذج',
  models: 'النماذج',
  new: 'جديد',
  of: 'من',
  omega: 'أوميغا',
  on: 'على',
  production: 'الإنتاج',
  read: 'اقرأ',
  released: 'أُطلق',
  returns: 'يعيد',
  run: 'شغّل',
  slower: 'أبطأ',
  team: 'الفريق',
  that: 'الذي',
  the: 'الـ',
  this: 'هذا',
  to: 'إلى',
  was: 'كان',
  week: 'الأسبوع',
  with: 'مع',
};

/** Fallback vocabulary, chosen by a stable hash so a word always maps the same way. */
const FALLBACK_WORDS: readonly string[] = [
  'شيء',
  'أمر',
  'عنصر',
  'فكرة',
  'حالة',
  'نقطة',
  'جانب',
  'مسألة',
  'عامل',
  'مجال',
  'قيمة',
  'نتيجة',
  'خطوة',
  'طريقة',
  'وسيلة',
  'هدف',
];

const PLACEHOLDER = /\[\[TH\d+\]\]/gu;
const LATIN_WORD = /[A-Za-z][A-Za-z'-]*/gu;

function arabicFor(word: string): string {
  const known = DICTIONARY[word.toLowerCase()];
  if (known !== undefined) return known;
  let hash = 0;
  for (const character of word.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return FALLBACK_WORDS[hash % FALLBACK_WORDS.length] ?? 'شيء';
}

function translateSegment(segment: string): string {
  LATIN_WORD.lastIndex = 0;
  return segment.replace(LATIN_WORD, (word) => arabicFor(word));
}

/** Substitutes Arabic for every Latin word except protection placeholders. */
export function pseudoTranslate(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  PLACEHOLDER.lastIndex = 0;
  let match = PLACEHOLDER.exec(text);
  while (match !== null) {
    parts.push(translateSegment(text.slice(lastIndex, match.index)));
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
    match = PLACEHOLDER.exec(text);
  }
  parts.push(translateSegment(text.slice(lastIndex)));
  return parts.join('');
}

export interface FakeProviderOptions {
  /** Replaces the translation payload, so malformed responses can be tested. */
  readonly translateOverride?: (request: TranslateRequest) => unknown;
  readonly summarizeThrows?: boolean;
  readonly summarizeOverride?: (request: SummarizeRequest) => unknown;
}

const META: LlmCallMeta = {
  provider: 'fake',
  model: 'fake-1',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
  durationMs: 0,
};

function result<TValue>(value: TValue): LlmResult<TValue> {
  return { value, meta: META };
}

export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';

  /** Every translate request the pipeline made, for prompt assertions. */
  readonly translateRequests: TranslateRequest[] = [];
  readonly summarizeRequests: SummarizeRequest[] = [];

  private readonly options: FakeProviderOptions;

  constructor(options: FakeProviderOptions = {}) {
    this.options = options;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async
  async generate(request: GenerateRequest): Promise<LlmResult<GeneratedPost | GeneratedThread>> {
    const content = request.context.topicName;
    return result<GeneratedPost>({ title: null, content, characterCount: content.length });
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async
  async summarize(request: SummarizeRequest): Promise<LlmResult<string>> {
    this.summarizeRequests.push(request);
    if (this.options.summarizeThrows === true) {
      throw new Error('summarize is unavailable');
    }
    if (this.options.summarizeOverride !== undefined) {
      return result(this.options.summarizeOverride(request) as string);
    }
    const sentences = request.text
      .split(/(?<=[.!?])\s+/u)
      .slice(0, request.maxSentences)
      .join(' ');
    return result(request.language === 'AR' ? pseudoTranslate(sentences) : sentences);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async
  async classify(request: ClassifyRequest): Promise<LlmResult<ClassificationResult>> {
    const label = request.labels[0] ?? 'unknown';
    return result({ label, confidence: 1, matchedLabels: [{ label, confidence: 1 }] });
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async
  async translate(request: TranslateRequest): Promise<LlmResult<TranslationOutput>> {
    this.translateRequests.push(request);
    if (this.options.translateOverride !== undefined) {
      return result(this.options.translateOverride(request) as TranslationOutput);
    }
    const translatedText =
      request.targetLanguage === 'AR' ? pseudoTranslate(request.text) : request.text;
    return result({
      translatedText,
      preservedTerms: request.preserveTerms,
      explanation: null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async
  async embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>> {
    return result({
      vectors: request.texts.map(() => [0]),
      dimensions: 1,
      model: this.model,
    });
  }
}
