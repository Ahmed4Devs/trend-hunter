import {
  characterCount,
  containsArabicScript,
  detectLanguage,
  LlmProviderError,
  sanitizeText,
  truncate,
  ValidationError,
} from '@trendhunter/shared';
import {
  DEFAULT_TERMINOLOGY_PREFERENCE,
  DEFAULT_TRANSLATION_MODE,
  type ContentLanguage,
  type LlmProvider,
  type TerminologyPreference,
  type TranslateRequest,
  type TranslationMode,
  type TranslationOutput,
} from '@trendhunter/types';

import { LocalizationService } from './localization-service';
import { TerminologyService } from './terminology-service';

/**
 * The translation pipeline.
 *
 * The model is one step of seven, and the six around it are what make the
 * output usable:
 *
 *  1. sanitise the source — it came from an RSS body or an X post;
 *  2. decide the source language, and refuse work that is already done;
 *  3. resolve which technical terms must survive;
 *  4. mask those terms so the model physically cannot translate them;
 *  5. call the provider with the mode's guidance;
 *  6. validate what comes back — shape, language and plausibility;
 *  7. restore the terms and apply the Arabic post-processing.
 *
 * Step 6 is not optional politeness. A provider adapter returns a typed object,
 * but the data inside it crossed a network from a system we do not control, so
 * it is re-checked as `unknown` here. Handing a model's raw output straight to
 * a user is how a truncated response, an English apology, or a refusal message
 * ends up published as someone's Arabic post.
 */

/** How much longer or shorter than the source a translation may plausibly be. */
const MAX_LENGTH_RATIO = 6;

/** Below this length the ratio check is noise, so it is not applied. */
const LENGTH_CHECK_MIN_CHARACTERS = 40;

/** Ceiling for the human-readable note stored on every translation. */
const MAX_EXPLANATION_CHARACTERS = 400;

const LANGUAGE_NAMES: Readonly<Record<ContentLanguage, string>> = {
  AR: 'Arabic',
  EN: 'English',
  OTHER: 'an unsupported language',
};

/** Raised when the caller asks for a translation into the language it is in. */
export class SameLanguageError extends ValidationError {
  readonly language: ContentLanguage;

  constructor(language: ContentLanguage) {
    super(`This text is already in ${LANGUAGE_NAMES[language]}; there is nothing to translate.`, {
      details: { language },
    });
    this.language = language;
  }
}

export interface TranslationRequest {
  readonly text: string;
  readonly targetLanguage: ContentLanguage;
  /** Skips detection. Supply it only when the caller genuinely knows. */
  readonly sourceLanguage?: ContentLanguage;
  readonly mode?: TranslationMode;
  readonly terminologyPreference?: TerminologyPreference;
  /** Surrounding narrative, when one segment of a longer piece is translated. */
  readonly contextSummary?: string;
  /** Caller-specific vocabulary to keep, on top of what is detected. */
  readonly additionalPreserveTerms?: readonly string[];
}

export interface TranslationResult {
  readonly translatedText: string;
  readonly sourceLanguage: ContentLanguage;
  readonly targetLanguage: ContentLanguage;
  readonly mode: TranslationMode;
  readonly terminologyPreference: TerminologyPreference;
  /** Terms that survived verbatim — not merely the terms we asked for. */
  readonly preservedTerms: readonly string[];
  readonly explanation: string;
  readonly providerName: string;
  readonly characterCount: number;
}

export interface TranslationServiceDependencies {
  readonly terminology?: TerminologyService;
  readonly localization?: LocalizationService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Re-parses a provider payload as if it were untyped, because at runtime it is.
 */
export function parseTranslationOutput(value: unknown, providerName: string): TranslationOutput {
  if (!isRecord(value)) {
    throw new LlmProviderError(providerName, 'The translation provider returned a non-object.');
  }

  const translatedText = value.translatedText;
  if (typeof translatedText !== 'string' || translatedText.trim().length === 0) {
    throw new LlmProviderError(providerName, 'The translation provider returned no text.');
  }

  const preservedTerms: string[] = [];
  const rawTerms = value.preservedTerms;
  if (Array.isArray(rawTerms)) {
    for (const entry of rawTerms as readonly unknown[]) {
      if (typeof entry === 'string' && entry.trim().length > 0) preservedTerms.push(entry.trim());
    }
  }

  const rawExplanation = value.explanation;
  const explanation = typeof rawExplanation === 'string' ? rawExplanation.trim() : null;

  return {
    translatedText: translatedText.trim(),
    preservedTerms,
    explanation: explanation !== null && explanation.length > 0 ? explanation : null,
  };
}

/**
 * Rejects output that cannot be a translation of this source.
 *
 * The language check is the one that earns its keep: when a model refuses, or
 * echoes the prompt, or silently returns the source unchanged, the answer is
 * still well-formed English and every structural check passes.
 */
export function assertPlausibleTranslation(
  output: TranslationOutput,
  source: string,
  targetLanguage: ContentLanguage,
  providerName: string,
): void {
  const sourceLength = characterCount(source);
  const translatedLength = characterCount(output.translatedText);

  if (sourceLength >= LENGTH_CHECK_MIN_CHARACTERS) {
    const ratio = translatedLength / sourceLength;
    if (ratio > MAX_LENGTH_RATIO || ratio < 1 / MAX_LENGTH_RATIO) {
      throw new LlmProviderError(
        providerName,
        `The translation is implausibly ${ratio > 1 ? 'long' : 'short'} for its source.`,
      );
    }
  }

  if (targetLanguage === 'AR' && !containsArabicScript(output.translatedText)) {
    throw new LlmProviderError(
      providerName,
      'The translation contains no Arabic script; the provider did not translate.',
    );
  }
  if (targetLanguage === 'EN' && detectLanguage(output.translatedText).language === 'AR') {
    throw new LlmProviderError(
      providerName,
      'The translation is still in Arabic; the provider did not translate.',
    );
  }
}

export class TranslationService {
  readonly terminology: TerminologyService;
  readonly localization: LocalizationService;

  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider, dependencies: TranslationServiceDependencies = {}) {
    this.provider = provider;
    this.terminology = dependencies.terminology ?? new TerminologyService();
    this.localization = dependencies.localization ?? new LocalizationService();
  }

  get providerName(): string {
    return this.provider.name;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const text = sanitizeText(request.text);
    if (text.length === 0) {
      throw new ValidationError('There is nothing to translate.');
    }
    if (request.targetLanguage === 'OTHER') {
      throw new ValidationError('A translation target must be Arabic or English.');
    }

    const sourceLanguage = request.sourceLanguage ?? detectLanguage(text).language;
    if (sourceLanguage === request.targetLanguage) {
      throw new SameLanguageError(sourceLanguage);
    }

    const mode = request.mode ?? DEFAULT_TRANSLATION_MODE;
    const terminologyPreference = request.terminologyPreference ?? DEFAULT_TERMINOLOGY_PREFERENCE;

    const resolved = this.terminology.resolvePreservedTerms(text, terminologyPreference);
    const preserveTerms = [...resolved, ...(request.additionalPreserveTerms ?? [])];
    const protectedSource = this.terminology.protectTerms(text, preserveTerms);

    const guidance = this.localization.buildGuidance({
      mode,
      targetLanguage: request.targetLanguage,
      protectedTokens: protectedSource.placeholders.map((placeholder) => placeholder.token),
      glossary:
        terminologyPreference === 'KEEP_COMMON_ENGLISH_TERMS'
          ? []
          : this.terminology.glossaryFor(text),
      contextSummary: request.contextSummary,
    });

    const providerRequest: TranslateRequest = {
      text: protectedSource.text,
      sourceLanguage,
      targetLanguage: request.targetLanguage,
      mode,
      terminologyPreference,
      preserveTerms: protectedSource.placeholders.map((placeholder) => placeholder.term),
      contextSummary: guidance,
    };

    const response = await this.provider.translate(providerRequest);
    const output = parseTranslationOutput(response.value, this.provider.name);
    assertPlausibleTranslation(
      output,
      protectedSource.text,
      request.targetLanguage,
      this.provider.name,
    );

    const restored = this.terminology.restoreTerms(
      output.translatedText,
      protectedSource.placeholders,
    );
    const localized = this.localization.localize(restored.text, mode, request.targetLanguage);

    return {
      translatedText: localized.text,
      sourceLanguage,
      targetLanguage: request.targetLanguage,
      mode,
      terminologyPreference,
      preservedTerms: restored.restoredTerms,
      explanation: this.buildExplanation({
        mode,
        preservedTerms: restored.restoredTerms,
        droppedTerms: restored.droppedTerms,
        appliedRules: localized.appliedRules,
        providerExplanation: output.explanation,
      }),
      providerName: this.provider.name,
      characterCount: characterCount(localized.text),
    };
  }

  /**
   * The note shown on the Translations page.
   *
   * It answers the two questions a user actually asks of a translation they
   * cannot verify themselves: what did this mode do to my text, and which words
   * were left in English.
   */
  private buildExplanation(input: {
    readonly mode: TranslationMode;
    readonly preservedTerms: readonly string[];
    readonly droppedTerms: readonly string[];
    readonly appliedRules: readonly string[];
    readonly providerExplanation: string | null;
  }): string {
    const parts: string[] = [this.localization.describe(input.mode)];

    if (input.preservedTerms.length > 0) {
      parts.push(`Kept in English: ${input.preservedTerms.join(', ')}.`);
    }
    if (input.droppedTerms.length > 0) {
      parts.push(
        `The model dropped these terms from its output: ${input.droppedTerms.join(', ')}.`,
      );
    }
    if (input.appliedRules.length > 0) {
      parts.push(`Arabic post-processing: ${[...new Set(input.appliedRules)].join(', ')}.`);
    }
    if (input.providerExplanation !== null) {
      parts.push(input.providerExplanation);
    }

    return truncate(parts.join(' '), MAX_EXPLANATION_CHARACTERS);
  }
}
