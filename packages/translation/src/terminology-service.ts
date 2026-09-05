import { DEFAULT_PRESERVED_TERMS, extractUrls, toLatinDigits } from '@trendhunter/shared';
import type { TerminologyPreference } from '@trendhunter/types';

/**
 * Terminology resolution: which English terms survive a translation untouched.
 *
 * The problem this solves is specific and it is the difference between Arabic
 * technical writing that reads well and Arabic technical writing that nobody
 * can follow. A model asked to translate "the API returns a token" into Arabic
 * will happily render *API* as واجهة برمجة التطبيقات in the middle of a 280
 * character post — technically correct, unreadable in practice, and no longer
 * searchable by the audience that uses the English term daily.
 *
 * Instructing the model to "keep API in English" is not enough: instructions
 * are advisory, and a model under length pressure drops them. So the terms are
 * physically removed from the text before the model sees it and put back
 * afterwards. The model never sees the word "API", therefore it cannot
 * translate it. That is what {@link TerminologyService.protectTerms} and
 * {@link TerminologyService.restoreTerms} are for.
 *
 * Everything here is pure and deterministic, so the same source text always
 * yields the same preserved-term set — which matters because that set is
 * persisted on every `Translation` row and shown to the user.
 */

export const TERM_KINDS = ['COMMON_TERM', 'ACRONYM', 'PRODUCT_NAME', 'CODE_IDENTIFIER'] as const;
export type TermKind = (typeof TERM_KINDS)[number];

export interface DetectedTerm {
  readonly term: string;
  readonly kind: TermKind;
}

export interface TermPlaceholder {
  /** The opaque token that replaced the term in the model-facing text. */
  readonly token: string;
  /** The canonical form the token is restored to. */
  readonly term: string;
}

export interface ProtectedText {
  readonly text: string;
  readonly placeholders: readonly TermPlaceholder[];
}

export interface RestoredText {
  readonly text: string;
  readonly restoredTerms: readonly string[];
  /** Terms whose placeholder the model deleted; they are missing from the output. */
  readonly droppedTerms: readonly string[];
}

export interface GlossaryEntry {
  readonly english: string;
  readonly arabic: string;
}

/**
 * Curated English → Arabic renderings for terms that *do* have an accepted
 * Arabic form.
 *
 * Two jobs. It is handed to the model as a glossary so that "embedding" is not
 * تضمين in one post and تجسيد in the next — consistency across the app is the
 * whole point of curating it. And it is the authority for
 * `ARABIC_WHEN_POSSIBLE`: a term listed here has an Arabic rendering worth
 * using, so it is *not* preserved in English under that preference.
 *
 * Entries are deliberately conservative. A term only earns a row once the
 * Arabic form is one a technical reader would actually recognise; the rest are
 * better left in English.
 */
const BASE_GLOSSARY: Readonly<Record<string, string>> = {
  API: 'واجهة برمجة التطبيقات',
  'AI Agent': 'وكيل ذكاء اصطناعي',
  'Artificial Intelligence': 'الذكاء الاصطناعي',
  Backend: 'الواجهة الخلفية',
  Bandwidth: 'عرض النطاق',
  Benchmark: 'اختبار أداء مرجعي',
  Browser: 'متصفّح',
  Client: 'عميل',
  Cloud: 'السحابة',
  Database: 'قاعدة بيانات',
  Dataset: 'مجموعة بيانات',
  'Deep Learning': 'التعلّم العميق',
  Deployment: 'النشر',
  Developer: 'مطوّر',
  Ecosystem: 'منظومة',
  Embedding: 'تضمين',
  Encryption: 'التشفير',
  Feature: 'ميزة',
  'Fine-tuning': 'الضبط الدقيق',
  Founder: 'مؤسّس',
  Framework: 'إطار عمل',
  Frontend: 'الواجهة الأمامية',
  Funding: 'تمويل',
  Hardware: 'العتاد',
  Inference: 'الاستدلال',
  Interface: 'واجهة',
  Latency: 'زمن الاستجابة',
  Library: 'مكتبة',
  'Machine Learning': 'تعلّم الآلة',
  Model: 'نموذج',
  Network: 'شبكة',
  'Open Source': 'مفتوح المصدر',
  Performance: 'الأداء',
  Pipeline: 'مسار المعالجة',
  Privacy: 'الخصوصية',
  Product: 'منتج',
  Prompt: 'الموجّه',
  Protocol: 'بروتوكول',
  Repository: 'مستودع',
  Revenue: 'الإيرادات',
  Roadmap: 'خارطة الطريق',
  Scalability: 'قابلية التوسّع',
  'Search Engine': 'محرك بحث',
  Security: 'الأمن',
  Server: 'خادم',
  Serverless: 'بلا خوادم',
  Software: 'البرمجيات',
  Startup: 'شركة ناشئة',
  Token: 'رمز',
  Training: 'التدريب',
  'User Experience': 'تجربة المستخدم',
  'User Interface': 'واجهة المستخدم',
  'Vector Database': 'قاعدة بيانات متجهية',
  Webhook: 'خطاف ويب',
};

/**
 * Proper nouns that a capitalisation rule cannot find on its own.
 *
 * `Kubernetes` and `Docker` are single capitalised words, indistinguishable
 * from a sentence-initial ordinary word by shape alone, so they are listed
 * rather than detected. They survive even `FULL_ARABIC`, because transcribing
 * a product name into Arabic script makes it unsearchable.
 */
const BASE_PRODUCT_NAMES: readonly string[] = [
  'Anthropic',
  'Android',
  'Apple',
  'AWS',
  'Azure',
  'Claude',
  'Cloudflare',
  'Docker',
  'Figma',
  'GitHub',
  'GitLab',
  'Google',
  'Kubernetes',
  'Linux',
  'Meta',
  'Microsoft',
  'NVIDIA',
  'Notion',
  'OpenAI',
  'Postgres',
  'Python',
  'React',
  'Redis',
  'Rust',
  'Slack',
  'Stripe',
  'Supabase',
  'Vercel',
  'Windows',
];

/** `API`, `LLM`, `CI/CD`, `B2B` — two to eight capitals, optionally slashed. */
const ACRONYM_PATTERN = /(?<![\p{L}\p{N}])[A-Z][A-Z0-9]{1,7}(?:\/[A-Z]{1,4})?(?![\p{L}\p{N}])/gu;

/** `GraphQL`, `TrendHunter`, `PostgreSQL` — an internal capital marks a product name. */
const PRODUCT_NAME_PATTERN =
  /(?<![\p{L}\p{N}])[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+(?![\p{L}\p{N}])/gu;

/** Anything the author wrapped in backticks is code by definition. */
const BACKTICK_PATTERN = /`([^`\n]{1,120})`/gu;

/**
 * `user_id`, `array.map`, `node.js`. The five-character floor keeps `e.g` and
 * `i.e` out; they are abbreviations, not identifiers, and translating around
 * them is fine.
 */
const CODE_IDENTIFIER_PATTERN =
  /(?<![\p{L}\p{N}])[a-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)+(?:\(\))?(?![\p{L}\p{N}])/gu;

const MIN_CODE_IDENTIFIER_LENGTH = 5;

/** Anchored forms of the three shapes, used to classify a term in isolation. */
const ACRONYM_SHAPE = /^[A-Z][A-Z0-9]{1,7}(?:\/[A-Z]{1,4})?$/u;
const PRODUCT_NAME_SHAPE = /^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+$/u;
const CODE_IDENTIFIER_SHAPE = /^[a-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)+(?:\(\))?$/u;

/**
 * Placeholder shape.
 *
 * Chosen to be short (it travels inside a 280 character budget), ASCII (an RTL
 * run does not reorder it), and to contain no word a model would try to
 * translate. The restore pattern is deliberately looser than the emit pattern:
 * models add spaces inside brackets and occasionally re-render the index in
 * Arabic-Indic digits, and neither should cost us a term.
 */
const PLACEHOLDER_RESTORE_PATTERN = /\[\s*\[\s*TH\s*([0-9٠-٩۰-۹]{1,3})\s*\]\s*\]/gu;

export function termPlaceholder(index: number): string {
  return `[[TH${String(index)}]]`;
}

/**
 * Escapes exactly the regex syntax characters and nothing else: the patterns
 * built from these terms carry the `u` flag, under which a superfluous escape
 * such as `\-` is a syntax error rather than a harmless belt-and-braces.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Longest first, then alphabetical.
 *
 * Order is load-bearing twice over: it makes the protection regex prefer
 * `Vector Database` over `Database`, and it makes the reported term list stable
 * between runs.
 */
function sortTerms(terms: readonly string[]): string[] {
  return [...terms].sort((a, b) => b.length - a.length || a.localeCompare(b, 'en'));
}

function dedupeByLowercase(terms: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const term of terms) {
    const key = term.toLowerCase();
    if (!seen.has(key)) seen.set(key, term);
  }
  return [...seen.values()];
}

function collectMatches(text: string, pattern: RegExp, group = 0): string[] {
  const found: string[] = [];
  // A fresh lastIndex per call: the patterns are module-level and global, so a
  // leaked index would silently skip the first terms of the next document.
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    const value = match[group];
    if (value !== undefined && value.trim().length > 0) found.push(value.trim());
    match = pattern.exec(text);
  }
  return found;
}

export interface TerminologyServiceOptions {
  /** Terms this deployment always keeps in English, on top of the platform list. */
  readonly additionalPreservedTerms?: readonly string[];
  /** Extra or overriding English → Arabic renderings. */
  readonly additionalGlossary?: Readonly<Record<string, string>>;
  readonly additionalProductNames?: readonly string[];
}

export class TerminologyService {
  private readonly commonTerms: readonly string[];
  private readonly glossary: ReadonlyMap<string, GlossaryEntry>;
  private readonly productNames: ReadonlyMap<string, string>;

  constructor(options: TerminologyServiceOptions = {}) {
    this.commonTerms = sortTerms(
      dedupeByLowercase([...DEFAULT_PRESERVED_TERMS, ...(options.additionalPreservedTerms ?? [])]),
    );

    const glossary = new Map<string, GlossaryEntry>();
    for (const [english, arabic] of Object.entries({
      ...BASE_GLOSSARY,
      ...options.additionalGlossary,
    })) {
      if (arabic.trim().length === 0) continue;
      glossary.set(english.toLowerCase(), { english, arabic });
    }
    this.glossary = glossary;

    const productNames = new Map<string, string>();
    for (const name of [...BASE_PRODUCT_NAMES, ...(options.additionalProductNames ?? [])]) {
      productNames.set(name.toLowerCase(), name);
    }
    this.productNames = productNames;
  }

  /** Every curated rendering, for a settings screen or a prompt preamble. */
  entries(): GlossaryEntry[] {
    return [...this.glossary.values()].sort((a, b) => a.english.localeCompare(b.english, 'en'));
  }

  /** The curated Arabic rendering of a term, if one exists. */
  arabicFor(term: string): string | undefined {
    return this.glossary.get(term.trim().toLowerCase())?.arabic;
  }

  /**
   * Whether the term has an Arabic rendering good enough to use. This is the
   * single question `ARABIC_WHEN_POSSIBLE` asks about every candidate.
   */
  hasAcceptedArabic(term: string): boolean {
    return this.glossary.has(term.trim().toLowerCase());
  }

  /** The glossary rows that actually occur in `text`, for the prompt preamble. */
  glossaryFor(text: string): GlossaryEntry[] {
    return this.entries().filter((entry) => containsTerm(text, entry.english));
  }

  /**
   * Finds the technical vocabulary in a piece of source text.
   *
   * Detection is shape-based, so it keeps working for products that did not
   * exist when this file was written — which is most of them, given the subject
   * matter.
   */
  detectTerms(text: string): DetectedTerm[] {
    const byKey = new Map<string, DetectedTerm>();
    const add = (term: string, kind: TermKind): void => {
      const trimmed = term.trim();
      if (trimmed.length < 2) return;
      const key = trimmed.toLowerCase();
      // First writer wins, and the order below runs from most specific to
      // least: a backticked `Docker` is code, not a loose product mention.
      if (!byKey.has(key)) byKey.set(key, { term: trimmed, kind });
    };

    // URLs first, and whole: a link is one indivisible identifier, and its host
    // would otherwise be picked up as a dotted identifier on its own.
    for (const url of extractUrls(text)) add(url, 'CODE_IDENTIFIER');
    for (const code of collectMatches(text, BACKTICK_PATTERN, 1)) add(code, 'CODE_IDENTIFIER');
    for (const identifier of collectMatches(text, CODE_IDENTIFIER_PATTERN)) {
      if (identifier.length >= MIN_CODE_IDENTIFIER_LENGTH) add(identifier, 'CODE_IDENTIFIER');
    }

    for (const term of this.commonTerms) {
      if (containsTerm(text, term)) add(term, this.kindForCommonTerm(term));
    }
    for (const canonical of this.productNames.values()) {
      if (containsTerm(text, canonical)) add(canonical, 'PRODUCT_NAME');
    }
    for (const name of collectMatches(text, PRODUCT_NAME_PATTERN)) add(name, 'PRODUCT_NAME');
    for (const acronym of collectMatches(text, ACRONYM_PATTERN)) add(acronym, 'ACRONYM');

    return sortTerms([...byKey.values()].map((entry) => entry.term)).map((term) => {
      const detected = byKey.get(term.toLowerCase());
      return detected ?? { term, kind: 'COMMON_TERM' };
    });
  }

  /**
   * The terms that must survive translation, for one text and one preference.
   *
   * Only terms that actually occur in the text are returned. A preserved-term
   * list containing words the reader never sees would be noise on the
   * Translations page, and the list is shown there verbatim.
   */
  resolvePreservedTerms(text: string, preference: TerminologyPreference): string[] {
    const detected = this.detectTerms(text);
    const kept = detected.filter((entry) => this.keepsTerm(entry, preference));
    return sortTerms(kept.map((entry) => entry.term));
  }

  /**
   * Replaces every occurrence of every term with an opaque token, in a single
   * left-to-right pass.
   *
   * One pass rather than one pass per term, for two reasons: alternation
   * ordered longest-first resolves `Vector Database` against `Database` the way
   * a human would, and a token emitted early can never be re-matched by a term
   * considered later.
   */
  protectTerms(text: string, terms: readonly string[]): ProtectedText {
    const ordered = sortTerms(dedupeByLowercase(terms.filter((term) => term.trim().length > 0)));
    if (ordered.length === 0) return { text, placeholders: [] };

    const placeholders: TermPlaceholder[] = [];
    const tokenByTerm = new Map<string, string>();
    for (const [index, term] of ordered.entries()) {
      const token = termPlaceholder(index);
      tokenByTerm.set(term.toLowerCase(), token);
      placeholders.push({ token, term });
    }

    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?:${ordered.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
      'giu',
    );
    const protectedText = text.replace(
      pattern,
      (match) => tokenByTerm.get(match.toLowerCase()) ?? match,
    );

    // Terms whose only occurrence sat inside a longer term were never emitted;
    // reporting them as preserved would be a lie.
    const used = placeholders.filter((entry) => protectedText.includes(entry.token));
    return { text: protectedText, placeholders: used };
  }

  /**
   * Puts the terms back, and reports on the model's behaviour while doing it.
   *
   * Restoration uses the canonical casing rather than whatever the source had,
   * so `api` and `API` come out identical across the app. Tokens the model
   * invented are removed: leaving `[[TH9]]` in published Arabic would be worse
   * than losing it.
   */
  restoreTerms(text: string, placeholders: readonly TermPlaceholder[]): RestoredText {
    const termByIndex = new Map<number, string>();
    for (const [index, placeholder] of placeholders.entries()) {
      const parsed = parsePlaceholderIndex(placeholder.token);
      termByIndex.set(parsed ?? index, placeholder.term);
    }

    const restored = new Set<string>();
    PLACEHOLDER_RESTORE_PATTERN.lastIndex = 0;
    const withTerms = text.replace(PLACEHOLDER_RESTORE_PATTERN, (_match, digits: string) => {
      const index = Number.parseInt(toLatinDigits(digits), 10);
      const term = termByIndex.get(index);
      if (term === undefined) return '';
      restored.add(term);
      return term;
    });

    return {
      text: tidySpacing(withTerms),
      restoredTerms: sortTerms([...restored]),
      droppedTerms: sortTerms(
        placeholders.map((entry) => entry.term).filter((term) => !restored.has(term)),
      ),
    };
  }

  private keepsTerm(entry: DetectedTerm, preference: TerminologyPreference): boolean {
    switch (preference) {
      case 'KEEP_COMMON_ENGLISH_TERMS':
        return true;
      // An Arabic rendering exists and is worth using, so the English form goes.
      case 'ARABIC_WHEN_POSSIBLE':
        return !this.hasAcceptedArabic(entry.term);
      // Proper nouns and code identifiers only. An acronym with no Arabic
      // rendering still gets translated descriptively under this preference —
      // that is what the reader asked for.
      case 'FULL_ARABIC':
        return entry.kind === 'PRODUCT_NAME' || entry.kind === 'CODE_IDENTIFIER';
    }
  }

  /**
   * Classifies a term from the platform list by its shape.
   *
   * The list is a list of things to keep, not a statement about what they are:
   * `GraphQL` is a product name and `CI/CD` is an acronym, and `FULL_ARABIC`
   * treats those two very differently.
   */
  private kindForCommonTerm(term: string): TermKind {
    if (this.productNames.has(term.toLowerCase())) return 'PRODUCT_NAME';
    if (PRODUCT_NAME_SHAPE.test(term)) return 'PRODUCT_NAME';
    if (CODE_IDENTIFIER_SHAPE.test(term)) return 'CODE_IDENTIFIER';
    return ACRONYM_SHAPE.test(term) ? 'ACRONYM' : 'COMMON_TERM';
  }
}

/** Whole-term, case-insensitive containment. `API` must not match `rapids`. */
export function containsTerm(text: string, term: string): boolean {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, 'iu');
  return pattern.test(text);
}

function parsePlaceholderIndex(token: string): number | undefined {
  PLACEHOLDER_RESTORE_PATTERN.lastIndex = 0;
  const match = PLACEHOLDER_RESTORE_PATTERN.exec(token);
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  const parsed = Number.parseInt(toLatinDigits(digits), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Repairs the double spaces and orphaned punctuation a removed token leaves. */
function tidySpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([،؛.,;!?؟])/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
}
