import type { MockAuthor, MockFeed, TailItem } from './types';

/**
 * Background chatter, personas and publications.
 *
 * The tail exists so that not every generated item belongs to a cluster. A
 * corpus in which every post has three siblings would let a clustering
 * threshold of "any two documents" look perfect, and the dashboard would show a
 * tidiness that real collection never produces.
 *
 * Roughly one in six tail items is Arabic, which is a deliberate choice rather
 * than a demographic claim: it is enough signal for the Arabic opportunity
 * score to rank meaningfully without swamping the English corpus.
 */
export const TAIL_ITEMS: readonly TailItem[] = [
  {
    id: 'tail-typed-config',
    category: 'apis',
    title: 'We deleted every optional field from our config schema',
    body: 'Optional configuration is a promise that some code path handles the absent case, and half the time no code path does. Making every field required with an explicit default moved a class of production surprise into start-up failure, which is where it belongs.',
    language: 'en',
  },
  {
    id: 'tail-oncall-rotation',
    category: 'automation',
    title: 'On-call is a product decision, not a rota problem',
    body: 'Every alert that pages a human at three in the morning is a feature that was shipped without an operational owner. We started reviewing alert volume in the same meeting as the roadmap and the volume halved in a quarter.',
    language: 'en',
  },
  {
    id: 'tail-pricing-page-copy',
    category: 'saas',
    title: 'Your pricing page is a support document',
    body: 'Most pricing pages are written to persuade and read to calculate. We rewrote ours as a reference — what counts as a unit, when it is measured, what happens at the limit — and enterprise questions during trials dropped noticeably.',
    language: 'en',
  },
  {
    id: 'tail-monorepo-regret',
    category: 'automation',
    title: 'Two years into a monorepo, here is what I would do differently',
    body: 'The tooling was never the hard part. The hard part was that a shared repository makes it socially easy to reach into another team’s code, and the boundaries you thought were architectural turn out to be entirely cultural.',
    language: 'en',
  },
  {
    id: 'tail-interview-take-home',
    category: 'startups',
    title: 'We replaced the take-home with a paid afternoon',
    body: 'Take-home exercises select for people with free evenings. Paying candidates for a short scoped session with a real part of the codebase gave us better signal and a much smaller drop-off rate, and it cost less than the engineering time we were spending on reviews.',
    language: 'en',
  },
  {
    id: 'tail-observability-cost',
    category: 'saas',
    title: 'Our observability bill exceeded our compute bill',
    body: 'Every team instruments enthusiastically and nobody deletes. Sampling the high-cardinality traces and dropping three debug metrics nobody had queried in a year cut the bill by more than half with no loss anyone noticed.',
    language: 'en',
  },
  {
    id: 'tail-migration-flags',
    category: 'apis',
    title: 'Long-lived feature flags are technical debt with a friendly name',
    body: 'A flag that has been on for everyone for eight months is not a flag, it is a branch in your code that nobody tests the other side of. We now expire flags automatically and it forced a lot of overdue cleanup.',
    language: 'en',
  },
  {
    id: 'tail-design-partner',
    category: 'startups',
    title: 'How to tell a design partner from a free user',
    body: 'A design partner changes their process for you. A free user changes nothing and gives feedback anyway. The distinction sounds obvious and we spent a year confusing the two, building for people who were never going to pay.',
    language: 'en',
  },
  {
    id: 'tail-sql-review',
    category: 'automation',
    title: 'Every query above a hundred milliseconds gets a review',
    body: 'Not a rewrite, a review. Somebody looks at the plan and writes two sentences about why it is acceptable. Half the time the answer is a missing index and the other half we learn something about the data distribution.',
    language: 'en',
  },
  {
    id: 'tail-changelog-habit',
    category: 'saas',
    title: 'A weekly changelog is the cheapest retention work available',
    body: 'Customers who read a changelog believe the product is alive. We publish every Thursday, we include the small fixes, and the correlation with expansion conversations is stronger than anything else we do at that cost.',
    language: 'en',
  },
  {
    id: 'tail-hiring-first-pm',
    category: 'startups',
    title: 'The first product hire should not be a product manager',
    body: 'At fifteen people the gap is usually research and writing, not prioritisation. A product manager arriving into a founder-led roadmap ends up coordinating rather than deciding, and both sides find the arrangement frustrating.',
    language: 'en',
  },
  {
    id: 'tail-sdk-versioning',
    category: 'apis',
    title: 'Ship the SDK a week after the API, not with it',
    body: 'Shipping both at once means every SDK bug looks like an API bug during the window when nobody knows the system yet. A week of lag gives the API surface time to prove itself against direct HTTP calls first.',
    language: 'en',
  },
  {
    id: 'tail-sales-demo-env',
    category: 'sales',
    title: 'Give your sales team a demo environment that cannot break',
    body: 'A demo against production data is a demo that fails in front of a prospect eventually. A seeded, resettable environment with realistic volumes removed a recurring category of lost deal that we had been attributing to the product.',
    language: 'en',
  },
  {
    id: 'tail-security-questionnaire',
    category: 'saas',
    title: 'The security questionnaire is a sales asset',
    body: 'We pre-answered the two hundred questions that appear in every enterprise review, published the answers, and cut a fortnight from the average deal. The document did more for velocity than any feature shipped that quarter.',
    language: 'en',
  },
  {
    id: 'tail-async-standup',
    category: 'startups',
    title: 'We killed the standup and nothing bad happened',
    body: 'What the standup was actually providing was a deadline for writing down what you were doing. A short written update at a fixed time provides the same thing without assembling eight people, and it is searchable six months later.',
    language: 'en',
  },
  {
    id: 'tail-embedding-drift',
    category: 'ai',
    title: 'Nobody plans for the day the embedding model changes',
    body: 'Vectors from two model versions are not comparable, so an upgrade means reindexing everything, and reindexing everything means a migration window nobody scheduled. Store the model identifier alongside every vector from day one.',
    language: 'en',
  },
  {
    id: 'tail-prompt-versioning',
    category: 'ai',
    title: 'Prompts belong in version control, obviously, and also in a database',
    body: 'In the repository so changes are reviewed, in the database so an incident can be fixed without a deploy. The tension between those two is real and pretending it does not exist produces a hotfix culture around a text file.',
    language: 'en',
  },
  {
    id: 'tail-invoice-ux',
    category: 'saas',
    title: 'Nobody reads your invoice until they are annoyed',
    body: 'Invoice design is a churn surface. A line item a finance team cannot map to a business activity generates a support ticket at best and a renewal conversation at worst, and it costs almost nothing to fix.',
    language: 'en',
  },
  {
    id: 'tail-rate-limit-headers',
    category: 'apis',
    title: 'Return your rate limit state in headers, always',
    body: 'A client that can see how much budget it has left can back off politely. A client that cannot will retry into your limiter and you will both have a worse day. Three headers, ten lines of middleware.',
    language: 'en',
  },
  {
    id: 'tail-founder-writing',
    category: 'startups',
    title: 'Writing publicly is the highest leverage thing a technical founder does',
    body: 'Not for the audience, though that helps. For the forcing function: an argument you cannot write down clearly is usually one you have not finished thinking about, and the cost of discovering that in public is much lower than in a roadmap.',
    language: 'en',
  },
  {
    id: 'tail-arabic-support-quality',
    category: 'gulf',
    title: 'جودة الدعم الفني بالعربية',
    body: 'معظم المنتجات تترجم واجهتها إلى العربية ثم تترك الدعم الفني بالإنجليزية فقط. النتيجة أن المستخدم يفهم الزر ولا يفهم الإجابة عند حدوث مشكلة، وهذا أسوأ من عدم الترجمة أصلاً.',
    language: 'ar',
  },
  {
    id: 'tail-arabic-rtl-bugs',
    category: 'gulf',
    title: 'أخطاء واجهات المستخدم في الاتجاه من اليمين إلى اليسار',
    body: 'أكثر الأخطاء تكراراً في الواجهات العربية هي الأيقونات التي لا تنعكس، والأرقام التي تُعرض بترتيب خاطئ داخل الجمل المختلطة. المشكلة ليست في التصميم بل في أن أحداً لم يختبر الواجهة بالعربية قبل الإطلاق.',
    language: 'ar',
  },
  {
    id: 'tail-arabic-hiring',
    category: 'gulf',
    title: 'توظيف المهندسين في السوق السعودي',
    body: 'المنافسة على المهندسين ذوي الخبرة في السعودية ارتفعت كثيراً خلال العامين الماضيين. الشركات التي تنجح في التوظيف ليست بالضرورة الأعلى راتباً، بل التي تقدّم مساراً تقنياً واضحاً بدل التحول الإجباري إلى الإدارة.',
    language: 'ar',
  },
  {
    id: 'tail-arabic-content-marketing',
    category: 'sales',
    title: 'المحتوى التقني بالعربية فرصة غير مستغلة',
    body: 'كمية المحتوى التقني العميق بالعربية ما زالت قليلة جداً مقارنة بحجم الطلب. من يكتب شرحاً واضحاً لمشكلة هندسية بالعربية اليوم يحصل على انتشار يصعب تحقيقه بالإنجليزية في المجال نفسه.',
    language: 'ar',
  },
  {
    id: 'tail-arabic-payment-flows',
    category: 'gulf',
    title: 'تجربة الدفع في المنطقة',
    body: 'تجربة الدفع الإلكتروني في الخليج تحسّنت كثيراً، لكن معالجة الأخطاء ما زالت ضعيفة. رسالة فشل عملية دفع مكتوبة بالإنجليزية فقط ودون سبب واضح هي أسرع طريقة لخسارة العميل عند الخطوة الأخيرة.',
    language: 'ar',
  },
  {
    id: 'tail-arabic-open-source',
    category: 'ai',
    title: 'المساهمة في المشاريع مفتوحة المصدر من المنطقة',
    body: 'عدد المساهمين من المنطقة في المشاريع مفتوحة المصدر ما زال أقل بكثير من حجم مجتمع المطورين. العائق الأكبر ليس اللغة بل غياب ثقافة المراجعة العامة للكود، وهذا يتغير ببطء.',
    language: 'ar',
  },
  {
    id: 'tail-testing-flakes',
    category: 'automation',
    title: 'A flaky test is an outage you have not had yet',
    body: 'The team habit of rerunning a red build until it goes green trains everyone to ignore the signal. We started quarantining flaky tests automatically and requiring an owner, and two of them turned out to be genuine race conditions.',
    language: 'en',
  },
  {
    id: 'tail-doc-rot',
    category: 'apis',
    title: 'Documentation that lives next to the code still rots, just slower',
    body: 'Proximity helps and it is not sufficient. What actually worked was executable examples: a docs snippet that runs in CI cannot silently describe an API that no longer exists.',
    language: 'en',
  },
  {
    id: 'tail-churn-interviews',
    category: 'sales',
    title: 'Churn interviews should be done by an engineer',
    body: 'Customer success hears reasons phrased politely. An engineer asking what specifically failed gets a reproduction case. We alternated who ran the calls and the difference in usable detail was stark.',
    language: 'en',
  },
  {
    id: 'tail-model-fallback',
    category: 'ai',
    title: 'Every AI feature needs a non-AI fallback path',
    body: 'Providers have outages, rate limits and occasional quality regressions. A degraded but deterministic path — a template, a keyword search, a queued human review — turns an incident into a slower experience rather than a broken one.',
    language: 'en',
  },
  {
    id: 'tail-onboarding-checklist',
    category: 'saas',
    title: 'The onboarding checklist that worked was three items long',
    body: 'Our original list had eleven steps and a completion rate under a fifth. Cutting it to the three that actually predicted retention raised completion dramatically, and the other eight turned out to be things users did anyway when they needed them.',
    language: 'en',
  },
  {
    id: 'tail-vendor-exit-plan',
    category: 'startups',
    title: 'Write the exit plan before you sign the vendor contract',
    body: 'Not because you expect to leave, but because writing it reveals how much of your product would be stranded. We discovered our authentication vendor held data we had no export path for, and negotiating that at signature cost nothing.',
    language: 'en',
  },
];

/**
 * X personas. Handles are invented; the `reach` tier scales engagement so a
 * large account and a small one do not draw from the same distribution.
 */
export const X_AUTHORS: readonly MockAuthor[] = [
  { id: '30140021', username: 'nadia_builds', name: 'Nadia Rahman', reach: 48000 },
  { id: '30140022', username: 'omar_ships', name: 'Omar Al-Fahad', reach: 21000 },
  { id: '30140023', username: 'devon_infra', name: 'Devon Marsh', reach: 96000 },
  { id: '30140024', username: 'pipeline_priya', name: 'Priya Venkatesan', reach: 13500 },
  { id: '30140025', username: 'quietmargins', name: 'Tom Weatherby', reach: 7400 },
  { id: '30140026', username: 'layla_scales', name: 'Layla Haddad', reach: 33000 },
  { id: '30140027', username: 'gtm_greg', name: 'Greg Petrov', reach: 5100 },
  { id: '30140028', username: 'sara_on_prem', name: 'Sara Lindqvist', reach: 61000 },
  { id: '30140029', username: 'khaled_codes', name: 'Khaled Al-Mutairi', reach: 18800 },
  { id: '30140030', username: 'the_retry_queue', name: 'Ines Duarte', reach: 2600 },
  { id: '30140031', username: 'mina_evals', name: 'Mina Okafor', reach: 27400 },
  { id: '30140032', username: 'colddata', name: 'Rob Iyer', reach: 3900 },
];

/** Reddit account names. Deliberately in the untidy style real accounts use. */
export const REDDIT_AUTHORS: readonly string[] = [
  'throwaway_pm_2019',
  'ScaledToZero',
  'not_a_devrel',
  'margins_and_moats',
  'quiet_operator',
  'bootstrapped_bee',
  'ex_enterprise_ae',
  'yet_another_cto',
  'gulfbuilder',
  'index_scan_only',
  'ticket_deflected',
  'weeknight_founder',
  'ops_on_call',
  'nullable_by_default',
];

/** Hacker News account names. */
export const HACKERNEWS_AUTHORS: readonly string[] = [
  'jrhodes',
  'annab',
  'skiplocked',
  'mfarid',
  'tsdiff',
  'grumpy_dba',
  'lena_k',
  'p_hartley',
  'cold_start',
  'vec_norm',
];

/** Subreddits the mock collector is configured against by default. */
export const REDDIT_SUBREDDITS: readonly string[] = [
  'SaaS',
  'startups',
  'ExperiencedDevs',
  'devops',
  'artificial',
  'sales',
];

/**
 * Publications behind the RSS corpus. Hosts use the reserved `example.com`
 * domain so a development dashboard never links to somebody else's site, and
 * both feed dialects are represented so the parser is exercised on each.
 */
export const MOCK_FEEDS: readonly MockFeed[] = [
  {
    id: 'signal-and-stack',
    title: 'Signal & Stack',
    feedUrl: 'https://signal-and-stack.example.com/feed.xml',
    siteUrl: 'https://signal-and-stack.example.com',
    format: 'rss',
    categories: ['ai', 'saas'],
  },
  {
    id: 'ledger-and-loop',
    title: 'Ledger & Loop',
    feedUrl: 'https://ledger-and-loop.example.com/atom.xml',
    siteUrl: 'https://ledger-and-loop.example.com',
    format: 'atom',
    categories: ['saas', 'sales', 'startups'],
  },
  {
    id: 'toolchain-weekly',
    title: 'Toolchain Weekly',
    feedUrl: 'https://toolchain-weekly.example.com/rss',
    siteUrl: 'https://toolchain-weekly.example.com',
    format: 'rss',
    categories: ['automation', 'apis'],
  },
  {
    id: 'gulf-tech-brief',
    title: 'Gulf Tech Brief',
    feedUrl: 'https://gulf-tech-brief.example.com/feed',
    siteUrl: 'https://gulf-tech-brief.example.com',
    format: 'atom',
    categories: ['gulf', 'startups'],
  },
  {
    id: 'retrieval-notes',
    title: 'Retrieval Notes',
    feedUrl: 'https://retrieval-notes.example.com/index.xml',
    siteUrl: 'https://retrieval-notes.example.com',
    format: 'rss',
    categories: ['ai', 'apis'],
  },
];

/** Bylines used by the feed generator. */
export const FEED_AUTHORS: readonly string[] = [
  'H. Okonjo',
  'M. Al-Sabah',
  'J. Prentice',
  'R. Nakamura',
  'E. Vasquez',
  'S. Berhane',
];

/**
 * Repositories with no matching seed. They give the GitHub connector a tail of
 * its own so cross-source clustering is not trivially satisfied by every repo.
 */
export const TAIL_REPOSITORIES: readonly {
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly language: string;
  readonly topics: readonly string[];
}[] = [
  {
    owner: 'sandbar-systems',
    name: 'schema-drift',
    description: 'Detects breaking changes between two versions of a JSON API response schema.',
    language: 'Rust',
    topics: ['api', 'schema', 'contract-testing'],
  },
  {
    owner: 'quietmargins',
    name: 'usage-meter',
    description: 'Billing-grade usage metering with idempotent event ingestion and replay.',
    language: 'TypeScript',
    topics: ['billing', 'metering', 'saas'],
  },
  {
    owner: 'orbitstack-io',
    name: 'flake-quarantine',
    description: 'Quarantines flaky tests automatically and assigns an owner from git history.',
    language: 'Python',
    topics: ['testing', 'ci', 'developer-tools'],
  },
  {
    owner: 'khaleej-nlp',
    name: 'arabizi',
    description: 'Latin-script Arabic detection and transliteration for search and moderation.',
    language: 'Python',
    topics: ['arabic', 'nlp', 'transliteration'],
  },
  {
    owner: 'stepwise-tools',
    name: 'webhook-inbox',
    description:
      'Durable webhook receiver with signature verification and a replayable dead letter queue.',
    language: 'Go',
    topics: ['webhooks', 'reliability', 'queue'],
  },
  {
    owner: 'agentmesh-labs',
    name: 'eval-harness',
    description: 'Deterministic evaluation runner for LLM pipelines with per-segment reporting.',
    language: 'TypeScript',
    topics: ['llm', 'evaluation', 'testing'],
  },
];
