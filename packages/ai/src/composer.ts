import {
  DEFAULT_THREAD_LENGTH,
  MAX_THREAD_LENGTH,
  MIN_THREAD_LENGTH,
  THREAD_COUNTER_RESERVED_CHARACTERS,
  X_LONG_POST_CHARACTER_LIMIT,
  X_POST_CHARACTER_LIMIT,
  characterCount,
  normalizeWhitespace,
  truncate,
} from '@trendhunter/shared';
import type {
  ContentDraftKind,
  ContentLanguage,
  ContentTone,
  GenerationContext,
} from '@trendhunter/types';

import { extractiveSummary, splitSentences } from './analysis';
import { pickDistinct, type Rng } from './deterministic';

/**
 * The copy generator behind the offline provider.
 *
 * Every line here is written the way the corresponding post would actually be
 * written — an X post that reads like an X post, an Arabic post that reads like
 * an Arabic post. That is deliberate: the Content Studio is judged on whether
 * its output is usable, and a page full of placeholder text would demonstrate
 * nothing. The banks are combined by a seeded PRNG, so a given request always
 * yields the same draft while different requests genuinely differ.
 */

/**
 * The editorial stance a draft takes, derived from its kind. It is what decides
 * which hook bank the post opens from and how the body is built.
 */
type Angle =
  | 'observation'
  | 'analysis'
  | 'teaching'
  | 'opinion'
  | 'business'
  | 'developer'
  | 'regional'
  | 'summary'
  | 'hook'
  | 'idea';

const ANGLE_BY_KIND: Readonly<Record<ContentDraftKind, Angle>> = {
  SHORT_X_POST: 'observation',
  LONG_X_POST: 'analysis',
  X_THREAD: 'analysis',
  EDUCATIONAL_POST: 'teaching',
  OPINION_POST: 'opinion',
  BUSINESS_ANGLE: 'business',
  DEVELOPER_ANGLE: 'developer',
  SAUDI_MARKET_ANGLE: 'regional',
  SUMMARY: 'summary',
  HOOK: 'hook',
  CONTENT_IDEA: 'idea',
};

/** Character budget per draft kind when the request does not name one. */
const DEFAULT_LIMIT_BY_KIND: Readonly<Record<ContentDraftKind, number>> = {
  SHORT_X_POST: X_POST_CHARACTER_LIMIT,
  LONG_X_POST: X_LONG_POST_CHARACTER_LIMIT,
  X_THREAD: X_POST_CHARACTER_LIMIT,
  EDUCATIONAL_POST: 1_200,
  OPINION_POST: 900,
  BUSINESS_ANGLE: 900,
  DEVELOPER_ANGLE: 900,
  SAUDI_MARKET_ANGLE: 900,
  SUMMARY: 600,
  HOOK: X_POST_CHARACTER_LIMIT,
  CONTENT_IDEA: X_POST_CHARACTER_LIMIT,
};

/** Kinds that are read as a document rather than a post, so they get a title. */
const TITLED_KINDS: ReadonlySet<ContentDraftKind> = new Set<ContentDraftKind>([
  'LONG_X_POST',
  'EDUCATIONAL_POST',
  'OPINION_POST',
  'BUSINESS_ANGLE',
  'DEVELOPER_ANGLE',
  'SAUDI_MARKET_ANGLE',
  'SUMMARY',
]);

/** Above this Arabic opportunity score the draft calls the gap out explicitly. */
const ARABIC_OPPORTUNITY_THRESHOLD = 60;

/** Longest excerpt fragment quoted inside a draft. */
const EXCERPT_LIMIT = 150;

type Bank = readonly [string, ...string[]];

interface CopyBank {
  readonly hooks: Readonly<Record<Angle, Bank>>;
  readonly evidence: Bank;
  readonly stance: Readonly<Record<ContentTone, Bank>>;
  readonly interest: Bank;
  readonly arabicOpportunity: Bank;
  readonly closers: Bank;
  readonly titles: Bank;
  readonly threadSteps: Bank;
  readonly threadOpeners: Bank;
  readonly threadConclusions: Bank;
  readonly ideaFormats: Bank;
  readonly summaryLead: Bank;
}

const ENGLISH: CopyBank = {
  hooks: {
    observation: [
      '{topic} went from niche to default faster than most teams planned for.',
      'Something shifted around {topic} this week, and it is not the headline.',
      'The interesting part of {topic} is not what it does. It is what it makes cheap.',
    ],
    analysis: [
      'Three things are happening at once in {topic}, and only one of them is priced in.',
      'A closer look at {topic}: the numbers say something different from the announcements.',
      '{topic} is easy to describe and hard to reason about. Here is the part that matters.',
    ],
    teaching: [
      '{topic}, explained without the hype.',
      'If you have been putting off understanding {topic}, start here.',
      'A short, practical guide to {topic} for people who have work to do.',
    ],
    opinion: [
      'Unpopular view: most of what is being said about {topic} is a distraction.',
      'I have changed my mind about {topic}, and this is why.',
      '{topic} is being judged on the wrong criteria.',
    ],
    business: [
      '{topic} is a cost line before it is a product line.',
      'The business case for {topic} is simpler than the pitch decks make it look.',
      'Whoever gets {topic} into their margins first stops competing on price.',
    ],
    developer: [
      'What {topic} actually changes in your codebase.',
      '{topic} for the people who have to ship it, not just talk about it.',
      'The integration story for {topic} is the whole story.',
    ],
    regional: [
      '{topic} in the Gulf is a different conversation from {topic} in San Francisco.',
      'Teams in Saudi Arabia looking at {topic} have one advantage nobody is naming.',
      'The regional read on {topic}: the constraint is talent, not capital.',
    ],
    summary: ['{topic}, in short.', 'Where {topic} stands right now, briefly.'],
    hook: [
      'Most people will read about {topic} this week. Almost none of them will act on it.',
      'You are about to hear a lot about {topic}. Here is the part worth keeping.',
    ],
    idea: [
      'Content idea: {topic}, from the angle nobody has taken yet.',
      'There is a post in {topic} that has not been written.',
    ],
  },
  evidence: [
    'What stood out: {excerpt}',
    'One detail worth keeping: {excerpt}',
    'From the coverage: {excerpt}',
    'The signal under the noise: {excerpt}',
    'Buried in the detail: {excerpt}',
  ],
  stance: {
    NEUTRAL: [
      'Worth tracking rather than reacting to.',
      'The picture is still forming, and that is fine.',
    ],
    FRIENDLY: [
      'If you are building anything nearby, this is genuinely good news.',
      'Happy to go deeper on any part of this.',
    ],
    AUTHORITATIVE: [
      'Having watched this space for a while: this one is structural, not cyclical.',
      'Treat this as a planning input now, not in six months.',
    ],
    ANALYTICAL: [
      'The mechanism matters more than the announcement: a constraint moved, so behaviour will follow.',
      'Follow the incentive and the rest of the story writes itself.',
    ],
    ENTHUSIASTIC: [
      'This is the most interesting thing to land all week.',
      'Genuinely excited about where this goes next.',
    ],
    CONTRARIAN: [
      'Everyone is looking at the demo. The interesting failure is one layer down.',
      'The consensus here is early, loud and probably wrong.',
    ],
  },
  interest: [
    'If you work in {interest}, this reaches your desk next quarter.',
    'This sits directly on top of {interest}.',
    'Anyone tracking {interest} should file this one.',
  ],
  arabicOpportunity: [
    'Almost none of this exists in Arabic yet. That gap is the opportunity.',
    'There is no serious Arabic coverage of this. That is a market, not an oversight.',
  ],
  closers: [
    'Worth watching this week.',
    'More on this as it develops.',
    'Curious what others are seeing here.',
    'Saving this one for later.',
  ],
  titles: [
    '{topic}: what actually changed',
    '{topic}, and what it means next',
    'Reading {topic} properly',
  ],
  threadSteps: [
    'First, the part everyone agrees on.',
    'Then it gets more interesting.',
    'This is where most takes stop, and where it starts to matter.',
    'Which raises the obvious question.',
    'The second-order effect is the real story.',
    'And here is the constraint nobody has priced in.',
    'One more thing that changes the read.',
  ],
  threadOpeners: ['Thread.', 'A thread. 🧵', 'Short thread on this.'],
  threadConclusions: [
    'To sum up: {topic} is less about the technology and more about who moves first.',
    'The short version: {topic} shifts the cost, and everything downstream reprices.',
    'Net: {topic} is worth a plan, not a reaction.',
  ],
  ideaFormats: [
    'Format: a 7-post thread, one claim per post, one number per claim.',
    'Format: a short explainer post plus a chart nobody else has drawn.',
    'Format: an opinion post that names the trade-off everyone is avoiding.',
  ],
  summaryLead: ['Here is the state of play.', 'The condensed version.'],
};

const ARABIC: CopyBank = {
  hooks: {
    observation: [
      '{topic} انتقل من هامش النقاش إلى مركزه أسرع مما خطّط له معظم الفرق.',
      'شيء ما تغيّر هذا الأسبوع في {topic}، والتغيير ليس في العناوين.',
      'الجزء المثير في {topic} ليس ما يفعله، بل ما يجعله رخيصاً.',
    ],
    analysis: [
      'ثلاثة أمور تحدث في {topic} في وقت واحد، وواحد منها فقط محسوب.',
      'قراءة أدق لـ {topic}: الأرقام تقول شيئاً مختلفاً عن الإعلانات.',
      '{topic} سهل الوصف وصعب التحليل، وهذه هي النقطة الأهم فيه.',
    ],
    teaching: [
      '{topic} بلا مبالغة، وبأبسط صورة ممكنة.',
      'إن كنت تؤجّل فهم {topic}، فهذه نقطة البداية.',
      'دليل عملي مختصر إلى {topic} لمن لديه عمل ينتظره.',
    ],
    opinion: [
      'رأي غير شائع: معظم ما يُقال عن {topic} مجرد تشتيت.',
      'غيّرت رأيي في {topic}، وهذا هو السبب.',
      '{topic} يُقيَّم بمعايير خاطئة.',
    ],
    business: [
      '{topic} بند تكلفة قبل أن يكون بند إيرادات.',
      'الجدوى التجارية لـ {topic} أبسط بكثير مما تُظهره العروض التقديمية.',
      'من يُدخل {topic} في هوامشه أولاً يتوقف عن المنافسة على السعر.',
    ],
    developer: [
      'ما الذي يغيّره {topic} فعلياً في شيفرتك؟',
      '{topic} لمن سيبنيه ويطلقه، لا لمن يكتفي بالحديث عنه.',
      'قصة الدمج في {topic} هي القصة كاملة.',
    ],
    regional: [
      '{topic} في الخليج نقاش مختلف تماماً عنه في وادي السيليكون.',
      'الفرق السعودية التي تنظر إلى {topic} تملك أفضلية لا يسمّيها أحد.',
      'القراءة الإقليمية لـ {topic}: القيد هو الكفاءات، لا رأس المال.',
    ],
    summary: ['{topic} باختصار.', 'أين يقف {topic} الآن، بإيجاز.'],
    hook: [
      'الجميع سيقرأ عن {topic} هذا الأسبوع، وقلة قليلة ستتحرك.',
      'ستسمع الكثير عن {topic}، وهذا هو الجزء الذي يستحق الاحتفاظ به.',
    ],
    idea: [
      'فكرة محتوى: {topic} من الزاوية التي لم يتناولها أحد بعد.',
      'هناك منشور عن {topic} لم يُكتب حتى الآن.',
    ],
  },
  evidence: [
    'ما لفت الانتباه: {excerpt}',
    'تفصيل يستحق الحفظ: {excerpt}',
    'من التغطية: {excerpt}',
    'الإشارة المهمة وسط الضجيج: {excerpt}',
  ],
  stance: {
    NEUTRAL: [
      'يستحق المتابعة أكثر مما يستحق ردة فعل سريعة.',
      'الصورة ما زالت تتشكّل، ولا بأس في ذلك.',
    ],
    FRIENDLY: [
      'إن كنت تبني شيئاً قريباً من هذا المجال فهذا خبر جيد فعلاً.',
      'يسعدني التوسّع في أي جزء من هذا.',
    ],
    AUTHORITATIVE: [
      'بعد متابعة طويلة لهذا المجال: التغيير هنا بنيوي وليس موسمياً.',
      'تعامل مع هذا كمُدخل تخطيط الآن، لا بعد ستة أشهر.',
    ],
    ANALYTICAL: [
      'الآلية أهم من الإعلان: القيد تغيّر، وبالتالي سيتغيّر السلوك.',
      'اتبع الحافز وسيكتب باقي القصة نفسه.',
    ],
    ENTHUSIASTIC: [
      'هذا أكثر ما أثار اهتمامي هذا الأسبوع.',
      'متحمّس فعلاً لما سيأتي بعد هذا.',
    ],
    CONTRARIAN: [
      'الجميع ينظر إلى العرض التوضيحي، والخلل الحقيقي في الطبقة التي تحته.',
      'الإجماع هنا مبكر وصاخب وغالباً خاطئ.',
    ],
  },
  interest: [
    'إن كان عملك في {interest} فسيصل هذا إلى مكتبك في الربع القادم.',
    'هذا يقع مباشرة فوق {interest}.',
    'من يتابع {interest} عليه أن يحفظ هذه النقطة.',
  ],
  arabicOpportunity: [
    'لا يكاد يوجد أي محتوى عربي جاد حول هذا حتى الآن، وهذه الفجوة هي الفرصة.',
    'لا توجد تغطية عربية جادة لهذا الموضوع، وهذا سوق وليس مجرد إغفال.',
  ],
  closers: [
    'يستحق المتابعة هذا الأسبوع.',
    'سأعود بتفاصيل أكثر مع تطوّر الموضوع.',
    'ما الذي يراه بقيّتكم هنا؟',
    'أحتفظ بهذه للرجوع إليها لاحقاً.',
  ],
  titles: [
    '{topic}: ما الذي تغيّر فعلاً',
    '{topic} وما يعنيه في المرحلة القادمة',
    'قراءة صحيحة لـ {topic}',
  ],
  threadSteps: [
    'أولاً، النقطة التي يتفق عليها الجميع.',
    'ثم يبدأ الجزء الأكثر إثارة للاهتمام.',
    'هنا تتوقف معظم التحليلات، وهنا تحديداً تبدأ الأهمية.',
    'وهذا يقودنا إلى سؤال بديهي.',
    'الأثر غير المباشر هو القصة الحقيقية.',
    'وهذا هو القيد الذي لم يحسبه أحد.',
    'نقطة أخيرة تغيّر القراءة كاملة.',
  ],
  threadOpeners: ['سلسلة.', 'سلسلة قصيرة. 🧵', 'سلسلة موجزة حول هذا.'],
  threadConclusions: [
    'الخلاصة: {topic} ليس عن التقنية بقدر ما هو عمّن يتحرك أولاً.',
    'باختصار: {topic} يغيّر التكلفة، وكل ما بعدها يُعاد تسعيره.',
    'المحصلة: {topic} يستحق خطة، لا ردة فعل.',
  ],
  ideaFormats: [
    'الصيغة المقترحة: سلسلة من سبعة منشورات، فكرة واحدة في كل منشور ورقم واحد لكل فكرة.',
    'الصيغة المقترحة: منشور تفسيري قصير مع رسم بياني لم يرسمه أحد قبلك.',
    'الصيغة المقترحة: منشور رأي يسمّي المفاضلة التي يتجنّبها الجميع.',
  ],
  summaryLead: ['هذا هو الوضع الحالي.', 'النسخة المختصرة.'],
};

function bankFor(language: ContentLanguage): CopyBank {
  return language === 'AR' ? ARABIC : ENGLISH;
}

interface Placeholders {
  readonly topic: string;
  readonly interest?: string;
  readonly excerpt?: string;
}

function fill(template: string, values: Placeholders): string {
  return template
    .replaceAll('{topic}', values.topic)
    .replaceAll('{interest}', values.interest ?? values.topic)
    .replaceAll('{excerpt}', values.excerpt ?? '');
}

/** A candidate paragraph and how badly the draft wants to keep it. */
interface Block {
  readonly text: string;
  readonly priority: number;
}

export interface ComposeInput {
  readonly kind: ContentDraftKind;
  readonly language: ContentLanguage;
  readonly tone: ContentTone;
  readonly context: GenerationContext;
  readonly maxCharacters?: number | undefined;
  readonly rng: Rng;
}

export interface ComposedPost {
  readonly title: string | null;
  readonly content: string;
}

export interface ComposedThread {
  readonly title: string;
  readonly posts: readonly string[];
}

export function composePost(input: ComposeInput): ComposedPost {
  const bank = bankFor(input.language);
  const limit = limitFor(input.kind, input.maxCharacters);
  const angle = ANGLE_BY_KIND[input.kind];
  const topic = normalizeWhitespace(input.context.topicName) || 'this topic';
  const excerpts = prepareExcerpts(input.context, input.rng);

  const hook = fill(input.rng.pick(bank.hooks[angle]), { topic });
  const blocks: Block[] = [{ text: hook, priority: 0 }];

  if (angle === 'hook') {
    return { title: null, content: fitToLimit(hook, limit) };
  }

  if (angle === 'summary') {
    const source = summarySource(input.context);
    const condensed = source.length > 0 ? extractiveSummary(source, 3) : '';
    if (condensed.length > 0) blocks.push({ text: condensed, priority: 1 });
    blocks.push({ text: input.rng.pick(bank.summaryLead), priority: 3 });
  } else if (angle === 'idea') {
    const excerpt = excerpts[0];
    if (excerpt) blocks.push({ text: fill(input.rng.pick(bank.evidence), { topic, excerpt }), priority: 1 });
    blocks.push({ text: input.rng.pick(bank.ideaFormats), priority: 2 });
  } else {
    const framings = pickDistinct(input.rng, bank.evidence, Math.max(1, excerpts.length));
    excerpts.forEach((excerpt, index) => {
      const framing = framings[index % framings.length] ?? bank.evidence[0];
      blocks.push({ text: fill(framing, { topic, excerpt }), priority: index === 0 ? 1 : 4 + index });
    });
    blocks.push({ text: input.rng.pick(bank.stance[input.tone]), priority: 2 });
  }

  const interest = input.context.interests[0];
  if (interest !== undefined) {
    blocks.push({ text: fill(input.rng.pick(bank.interest), { topic, interest }), priority: 5 });
  }

  const opportunity = input.context.arabicOpportunityScore;
  if (opportunity !== null && opportunity >= ARABIC_OPPORTUNITY_THRESHOLD) {
    blocks.push({ text: input.rng.pick(bank.arabicOpportunity), priority: 6 });
  }

  blocks.push({ text: input.rng.pick(bank.closers), priority: 3 });

  const content = assembleBlocks(blocks, limit);
  const title = TITLED_KINDS.has(input.kind)
    ? fitToLimit(fill(input.rng.pick(bank.titles), { topic }), 120)
    : null;

  return { title, content };
}

export function composeThread(input: ComposeInput & { threadLength?: number }): ComposedThread {
  const bank = bankFor(input.language);
  const topic = normalizeWhitespace(input.context.topicName) || 'this topic';
  const total = clampThreadLength(input.threadLength);
  const excerpts = prepareExcerpts(input.context, input.rng);
  const postLimit = Math.min(
    input.maxCharacters ?? X_POST_CHARACTER_LIMIT,
    X_POST_CHARACTER_LIMIT,
  );
  const bodyLimit = Math.max(1, postLimit - THREAD_COUNTER_RESERVED_CHARACTERS);

  const bodies: string[] = [];
  bodies.push(
    [fill(input.rng.pick(bank.hooks[ANGLE_BY_KIND[input.kind]]), { topic }), input.rng.pick(bank.threadOpeners)].join(
      ' ',
    ),
  );

  for (let position = 1; position < total - 1; position += 1) {
    bodies.push(threadBody(position, { bank, topic, excerpts, input }));
  }

  if (total > 1) {
    const conclusion = fill(input.rng.pick(bank.threadConclusions), { topic });
    bodies.push(`${conclusion} ${input.rng.pick(bank.closers)}`);
  }

  // The counter is prefixed after fitting, against a body budget that already
  // reserves room for it, so no post can overflow once numbered.
  const posts = bodies.map(
    (body, index) => `${index + 1}/${total} ${fitToLimit(body, bodyLimit)}`,
  );

  return { title: fitToLimit(fill(input.rng.pick(bank.titles), { topic }), 120), posts };
}

interface ThreadBodyInput {
  readonly bank: CopyBank;
  readonly topic: string;
  readonly excerpts: readonly string[];
  readonly input: ComposeInput;
}

/**
 * Body of one middle post.
 *
 * The step phrases are walked in order rather than drawn at random, which is
 * what makes the thread build: post three genuinely follows post two instead of
 * restating it.
 */
function threadBody(position: number, context: ThreadBodyInput): string {
  const { bank, topic, excerpts, input } = context;
  const step = bank.threadSteps[(position - 1) % bank.threadSteps.length] ?? bank.threadSteps[0];
  const excerpt = excerpts[(position - 1) % Math.max(1, excerpts.length)];

  if (excerpt !== undefined) {
    return `${step} ${fill(input.rng.pick(bank.evidence), { topic, excerpt })}`;
  }

  const interest = input.context.interests[(position - 1) % Math.max(1, input.context.interests.length)];
  if (interest !== undefined) {
    return `${step} ${fill(input.rng.pick(bank.interest), { topic, interest })}`;
  }
  return `${step} ${input.rng.pick(bank.stance[input.tone])}`;
}

export function clampThreadLength(requested: number | undefined): number {
  const wanted = requested ?? DEFAULT_THREAD_LENGTH;
  if (!Number.isFinite(wanted)) return DEFAULT_THREAD_LENGTH;
  return Math.min(MAX_THREAD_LENGTH, Math.max(MIN_THREAD_LENGTH, Math.floor(wanted)));
}

function limitFor(kind: ContentDraftKind, maxCharacters: number | undefined): number {
  const kindLimit = DEFAULT_LIMIT_BY_KIND[kind];
  if (maxCharacters === undefined || !Number.isFinite(maxCharacters)) return kindLimit;
  return Math.max(1, Math.min(Math.floor(maxCharacters), kindLimit));
}

/**
 * Assembles blocks in source order, admitting them by priority until the
 * budget runs out.
 *
 * Dropping a whole paragraph produces a shorter post that still reads as
 * finished; truncating the assembled text produces one that stops mid-thought.
 * Truncation stays as the last resort for the case where even the hook is too
 * long for the requested budget.
 */
function assembleBlocks(blocks: readonly Block[], limit: number): string {
  const ordered = blocks.map((block, index) => ({ ...block, index }));
  const byPriority = [...ordered].sort((a, b) => a.priority - b.priority || a.index - b.index);

  const admitted = new Set<number>();
  let used = 0;
  for (const block of byPriority) {
    if (block.text.length === 0) continue;
    const cost = characterCount(block.text) + (admitted.size > 0 ? 2 : 0);
    if (admitted.size > 0 && used + cost > limit) continue;
    admitted.add(block.index);
    used += cost;
  }

  const content = ordered
    .filter((block) => admitted.has(block.index))
    .map((block) => block.text)
    .join('\n\n');

  return fitToLimit(content, limit);
}

function prepareExcerpts(context: GenerationContext, rng: Rng): string[] {
  const cleaned = context.sourceExcerpts
    .map((excerpt) => normalizeWhitespace(excerpt))
    .filter((excerpt) => excerpt.length > 0)
    .map((excerpt) => {
      const [first] = splitSentences(excerpt);
      return truncate(first ?? excerpt, EXCERPT_LIMIT);
    })
    .filter((excerpt) => excerpt.length > 0);

  const unique = [...new Set(cleaned)];
  // Three quotes is as many as a post can carry before it stops being a post.
  return unique.length <= 3 ? unique : pickDistinct(rng, unique, 3);
}

function summarySource(context: GenerationContext): string {
  return [context.topicSummary ?? '', ...context.sourceExcerpts]
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0)
    .join(' ');
}

/**
 * Trims to a character budget counted the way X counts it.
 *
 * `truncate` from `@trendhunter/shared` measures with `String.length`, which
 * over-counts astral characters — an emoji in a thread post would cost two and
 * cut the text short of the real limit.
 */
export function fitToLimit(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (characterCount(text) <= limit) return text;

  const points = Array.from(text.normalize('NFC'));
  const hardCut = points.slice(0, Math.max(1, limit - 1)).join('');
  const lastSpace = hardCut.lastIndexOf(' ');
  const body = lastSpace > limit * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${body.trimEnd()}…`;
}
