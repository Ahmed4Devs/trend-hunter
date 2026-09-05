/**
 * `@trendhunter/translation` — Arabic localisation.
 *
 * Arabic is not a post-processing step bolted onto this product; it is the
 * product. The package is built around two convictions that the rest of the
 * codebase depends on:
 *
 *  - **A thread is translated as one narrative.** Per-post translation loses
 *    the cross-references between posts and flattens the hook and the
 *    conclusion. See {@link ThreadTranslatorService}.
 *  - **The model is never trusted with terminology.** Terms that must stay in
 *    English are removed from the text before the model sees it and put back
 *    afterwards, so no instruction can be ignored under length pressure. See
 *    {@link TerminologyService}.
 *
 * The LLM arrives as an injected `LlmProvider`, so nothing here knows which
 * vendor is answering, and every provider payload is re-validated as untrusted
 * input before any of it reaches a user.
 */

export * from './terminology-service';
export * from './arabic-optimizer-service';
export * from './localization-service';
export * from './translation-service';
export * from './thread-translator-service';
