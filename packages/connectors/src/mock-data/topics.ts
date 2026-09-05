import type { TopicSeed } from './types';

/**
 * The synthetic event corpus.
 *
 * Each seed is one event told five ways. The wording deliberately diverges
 * between sources — an X post argues, a Reddit title asks, a Hacker News title
 * states, a feed headline announces — because a clustering algorithm that only
 * works on near-identical strings is worthless in production, and a corpus of
 * near-identical strings would never reveal that.
 *
 * All text here is original, written for this repository. No real article,
 * account, company or person is reproduced; every handle, publication and
 * repository name is invented, and link hosts use the reserved `example.com`
 * domain so nothing in a development dashboard points at somebody else's site.
 */
export const TOPIC_SEEDS: readonly TopicSeed[] = [
  {
    id: 'agent-memory-standard',
    slug: 'portable-agent-memory',
    category: 'ai',
    keywords: ['ai agents', 'memory', 'interoperability', 'open standard', 'context'],
    brokeHoursAgo: 5,
    momentum: 'breaking',
    weight: 10,
    linkDomain: 'signal-and-stack.example.com',
    headlines: {
      x: [
        'Someone finally wrote down a portable format for agent memory. Every framework storing context in its own bespoke JSON blob has been the quiet reason you cannot switch vendors.',
        'The agent memory spec landed and the interesting part is not the schema, it is that it makes migration a two hour job instead of a rewrite.',
        'Hot take: portable agent memory matters more than another two points on a benchmark. Lock-in has never been about the model.',
        'Read the portable memory draft twice. It handles episodic recall and tool results, and it says nothing about embeddings, which I think is correct.',
      ],
      reddit: [
        'Has anyone actually migrated agent memory between two frameworks? The new portable format claims it is possible',
        'The portable agent memory draft is out — what does it get wrong?',
        'We store 40GB of agent conversation state in a vendor format. Is the new spec a way out?',
      ],
      hackernews: [
        'A portable format for agent memory',
        'Show HN: Converter between four agent memory formats',
      ],
      rss: [
        'Portable agent memory: the specification that could end framework lock-in',
        'Why the agent memory draft matters more than the next model release',
        'Inside the portable memory format: episodic recall, tool results, and no embeddings',
      ],
    },
    bodies: [
      'Every agent framework invented its own way to persist what an agent knows. The result is that switching frameworks means either dropping months of accumulated context or writing a bespoke exporter. The draft published this week defines a small envelope: a conversation identifier, an ordered list of episodes, tool invocations with their results, and a free-form annotations bag that implementations may use without breaking readers. Notably it refuses to specify an embedding format, on the grounds that vectors are a cache and not a source of truth.',
      'We spent a week writing an exporter from our agent runtime into the draft format and back again. The round trip was lossless for everything except our custom scoring metadata, which survived in the annotations bag. What surprised us is how much of our memory layer turned out to be incidental — once the envelope was fixed, roughly a third of our persistence code had nothing left to do.',
      'The objection worth taking seriously is that a portable memory format standardises the wrong layer. If two agents disagree about what an episode is, a shared envelope only moves the incompatibility one level down. The counterargument is that this is exactly what happened with feed formats, and a slightly wrong shared envelope still beat five right proprietary ones.',
    ],
    comments: [
      'The lossless round trip claim is doing a lot of work here. We tried it and anything with tool call streaming got flattened into a single result blob.',
      'Genuine question: what happens to memory that was summarised by a model? The summary is derived data but you cannot regenerate it without the original model version.',
      'This is the first agent spec I have read that is short enough to implement in an afternoon. That is not a small thing.',
      'Our problem was never the format, it was that nobody could tell us what the retention policy should be. A spec that says nothing about deletion is only half a spec.',
      'Migrated our staging environment yesterday. Two hours, mostly spent on our own bad assumptions about ordering. The format itself was fine.',
      'Everyone is excited about switching vendors but the real win is being able to diff agent memory between two runs. We have wanted that for a year.',
    ],
    arabic: [
      'أخيراً ظهرت مواصفة مفتوحة لنقل ذاكرة الوكلاء الأذكياء بين المنصات. المشكلة لم تكن يوماً في النموذج، بل في أن كل إطار عمل يخزّن السياق بطريقته الخاصة.',
      'قرأت مسودة تنسيق الذاكرة المحمولة، وأهم ما فيها أنها لا تفرض شكلاً معيناً للتضمينات. هذا قرار صحيح في رأيي، لأن المتجهات ذاكرة مؤقتة وليست مصدر الحقيقة.',
      'الترحيل بين أطر عمل الوكلاء كان يستغرق أسابيع. مع المواصفة الجديدة أصبح المشروع يقاس بالساعات، وهذا يغيّر حسابات الارتباط بمزوّد واحد.',
    ],
    repository: {
      owner: 'agentmesh-labs',
      name: 'portable-memory',
      description:
        'Reference implementation and converters for the portable agent memory envelope.',
      language: 'TypeScript',
      topics: ['ai-agents', 'memory', 'interoperability', 'specification'],
      releaseTag: 'v0.4.0',
      releaseTitle: 'v0.4.0 — lossless tool result round trip',
      releaseNotes:
        'Tool invocations now round trip with their streamed chunks intact instead of being flattened into a single result. Adds converters for two more runtimes, and a `verify` command that reports exactly which fields a conversion dropped. Breaking: the annotations bag is now namespaced by implementation identifier.',
    },
  },
  {
    id: 'inference-price-drop',
    slug: 'inference-prices-fall-again',
    category: 'ai',
    keywords: ['llm', 'inference', 'pricing', 'margins', 'cost'],
    brokeHoursAgo: 14,
    momentum: 'rising',
    weight: 9,
    linkDomain: 'ledger-and-loop.example.com',
    headlines: {
      x: [
        'Inference prices dropped again this quarter. If your product’s only moat was buying tokens in bulk, that moat just evaporated for the third time in a year.',
        'The uncomfortable arithmetic: cheaper tokens make your gross margin better and your differentiation worse, at exactly the same rate.',
        'Everyone reads a price cut as good news for AI startups. It is good news for AI features and bad news for AI companies.',
        'We repriced our whole product after the latest inference cut. Took a day. The hard part was explaining to customers why the number went down.',
      ],
      reddit: [
        'Inference costs dropped again — how are you repricing without training customers to wait for the next cut?',
        'Our AI feature went from 30% to 8% of COGS in eleven months. What do you even do with that?',
        'Is anyone still building a business on cheap tokens, or has everyone moved to workflow lock-in?',
      ],
      hackernews: [
        'Inference is now cheap enough that the bottleneck is your database',
        'The economics of AI features after the third price cut',
      ],
      rss: [
        'Token prices fall again: what it does to AI product margins',
        'Cheap inference is remaking the AI pricing page',
        'When your cost base halves twice a year, pricing becomes a strategy problem',
      ],
    },
    bodies: [
      'The pattern is now familiar enough to plan around. Every few months the per-token price of a capable model falls by a meaningful multiple, and every AI product built on top of it finds its cost of goods sold quietly improving. The trap is treating that as free margin. Customers read the same announcements, and a buyer who knows your input cost halved will ask what happened to their invoice.',
      'We ran the numbers across eighteen months of usage. Our inference spend per active account fell by a factor of six while the volume of calls per account grew by four, which is to say the cheaper tokens got spent immediately on doing more work per request rather than being banked. That is probably the right decision, but nobody made it deliberately.',
      'The teams that came out of this well had one thing in common: they never sold tokens. They sold an outcome — a resolved ticket, a qualified lead, a finished draft — and the token cost was an implementation detail behind that price. When the input cost fell, their margin improved and their price stayed defensible.',
    ],
    comments: [
      'We made the mistake of pricing per thousand tokens because it felt transparent. Now every price cut is a customer conversation about a refund.',
      'The real cost is not inference any more. It is the retrieval layer, the eval harness and the humans reviewing the output. Nobody puts those on a pricing page.',
      'Counterpoint: cheaper tokens let us finally run the two-pass approach we always wanted. Quality went up more than margin did.',
      'Anyone else notice the price cut only applies to the models you were already trying to migrate off?',
      'Our finance team refuses to model a cost base that halves unpredictably. I do not blame them.',
    ],
    arabic: [
      'انخفضت أسعار الاستدلال مرة أخرى هذا الربع. إذا كانت ميزتك التنافسية الوحيدة هي شراء الرموز بسعر الجملة، فقد اختفت هذه الميزة للمرة الثالثة خلال عام.',
      'المفارقة أن انخفاض تكلفة النماذج يحسّن هامش الربح ويقلّل التمايز بالسرعة نفسها. الفرق بين من ينجو ومن لا ينجو هو هل تبيع رموزاً أم نتيجة.',
    ],
  },
  {
    id: 'long-context-vs-rag',
    slug: 'long-context-versus-retrieval',
    category: 'ai',
    keywords: ['rag', 'retrieval', 'long context', 'embeddings', 'vector database'],
    brokeHoursAgo: 40,
    momentum: 'steady',
    weight: 7,
    linkDomain: 'retrieval-notes.example.com',
    headlines: {
      x: [
        'Every time context windows grow someone declares retrieval dead. Then they try to put a 400 page contract corpus in a prompt and rediscover why we index things.',
        'Long context did not kill RAG. It killed bad RAG, which was most of it, and that is a genuinely good outcome.',
        'The retrieval question was never "can the model see it". It was "can you afford to send it, and can you tell me why it answered that".',
        'Stop benchmarking retrieval on needle-in-a-haystack. Real corpora have twelve near-identical documents and one of them is current.',
      ],
      reddit: [
        'Is RAG still worth the complexity now that context windows are huge?',
        'We deleted our vector database and just send more context. Six weeks in, here is what broke',
        'How do you handle the case where retrieval finds four versions of the same policy document?',
      ],
      hackernews: [
        'Retrieval is not dead, your chunking strategy is',
        'We replaced our vector store with a well-tuned keyword index',
      ],
      rss: [
        'Long context versus retrieval: a cost and traceability comparison',
        'The retrieval layer nobody wants to maintain is the one doing the work',
        'When bigger context windows make your answers worse',
      ],
    },
    bodies: [
      'The argument that longer context windows make retrieval obsolete assumes the constraint was the model. For most teams the constraint is the invoice and the audit trail. Sending an entire document set on every request costs real money at volume, and when an answer is wrong, "the model saw everything" is a much harder thing to debug than "these four passages were retrieved and here is their ranking".',
      'We ran the experiment properly: same questions, same model, one arm with a tuned hybrid retriever and one arm dumping the full corpus into context. Accuracy was within noise on straightforward lookups. On questions where the corpus contained conflicting versions of a document, the retrieval arm won clearly, because ranking gave the current version a chance to dominate and raw context did not.',
      'The most useful thing we did was stop chunking on token counts and start chunking on document structure. Sections, not windows. Recall improved more from that one change than from replacing the embedding model twice.',
    ],
    comments: [
      'The conflicting-versions problem is the whole game in regulated industries and almost nobody benchmarks it.',
      'We kept retrieval purely because we need to show the user a citation. That requirement alone settles the argument for us.',
      'Hybrid keyword plus vector beat pure vector for us by a wide margin and cost a fraction. Everyone skips the boring option.',
      'Honest question: at what corpus size does dumping everything into context stop being viable? We are at 200k tokens and it is fine.',
      'Chunking on structure instead of token count is underrated advice. Took us one afternoon and fixed half our bad answers.',
      'Our latency doubled when we removed retrieval. Nobody mentions time to first token in these debates.',
    ],
    arabic: [
      'كلما اتسعت نافذة السياق أعلن أحدهم موت الاسترجاع، ثم يحاول إدخال آلاف الصفحات في الطلب ويكتشف من جديد لماذا نبني الفهارس.',
      'السؤال لم يكن يوماً هل يستطيع النموذج رؤية المستند، بل هل تستطيع تحمّل تكلفة إرساله كاملاً، وهل تستطيع تفسير سبب الإجابة لاحقاً.',
    ],
    repository: {
      owner: 'orbitstack-io',
      name: 'hybrid-retriever',
      description:
        'Structure-aware chunking and hybrid keyword plus vector retrieval with explainable ranking.',
      language: 'Python',
      topics: ['rag', 'retrieval', 'search', 'embeddings'],
      releaseTag: 'v1.2.0',
      releaseTitle: 'v1.2.0 — structure-aware chunking',
      releaseNotes:
        'Chunk boundaries now follow document structure rather than token windows, which improved recall on our internal evaluation set by a wide margin. Adds a version-aware reranker for corpora containing multiple revisions of the same document, and per-passage score attribution in the API response.',
    },
  },
  {
    id: 'seat-pricing-collapse',
    slug: 'per-seat-pricing-under-agents',
    category: 'saas',
    keywords: ['pricing', 'saas', 'per seat', 'agents', 'outcome pricing'],
    brokeHoursAgo: 20,
    momentum: 'rising',
    weight: 9,
    linkDomain: 'ledger-and-loop.example.com',
    headlines: {
      x: [
        'Per-seat pricing assumes work is done by people sitting at seats. Your customer just replaced four of those seats with one agent and a queue. The pricing model is the product risk now.',
        'Nobody churns loudly from seat-based software. They just stop adding seats, and eighteen months later you notice net revenue retention is under 100.',
        'The move from seats to usage is not a pricing tweak, it is a rebuild of your metering, your invoicing and your sales comp all at once.',
        'Every seat-priced tool is about to find out how much of its revenue was headcount growth wearing a product costume.',
      ],
      reddit: [
        'Our customers are automating away the seats they pay us for. How do you reprice without a revenue cliff?',
        'Moving from per-seat to usage-based pricing — what nobody warned us about',
        'Is per-seat pricing actually dying or is this just LinkedIn noise?',
      ],
      hackernews: [
        'Per-seat pricing in a world where the seat is an agent',
        'We moved from seats to outcomes and our revenue went sideways for two quarters',
      ],
      rss: [
        'The quiet collapse of per-seat pricing',
        'Metering, invoicing and comp: the three rebuilds hidden inside a pricing change',
        'What replaces the seat when the work is automated?',
      ],
    },
    bodies: [
      'Seat-based pricing worked because it correlated with value in a legible way: more people using the tool meant more work getting done in it. Automation breaks the correlation without breaking the tool. Usage goes up, seats go down, and the invoice follows the seats. The failure is slow enough that it usually shows up as flat expansion revenue rather than churn, which makes it easy to misdiagnose as a sales problem.',
      'The rebuild is bigger than the pricing page. You need metering you trust well enough to bill from, which is a different bar than metering you trust well enough to chart. You need invoicing that can explain a variable line item to a procurement team. And you need to repay your sales team for deals whose value now arrives over twelve months instead of at signature.',
      'We ran both models in parallel for two quarters. New customers went to usage pricing, existing ones kept seats until renewal. The transition period was ugly in the reporting — two revenue shapes in one chart — but it meant we found the metering bugs on ten accounts instead of a thousand.',
    ],
    comments: [
      'The comp rebuild is the part that kills these transitions. Your best reps will leave before they take a variable quota.',
      'We hit the metering trust problem hard. Billing from an event stream that occasionally double counts is a legal problem, not an engineering one.',
      'Procurement teams hate variable line items more than they hate high prices. Nobody talks about this.',
      'Hybrid worked for us: a platform fee for access plus usage above a threshold. Keeps the floor predictable.',
      'Counterpoint: seats are still fine if your buyer is a department that is growing. Not every market is being automated.',
    ],
    arabic: [
      'التسعير حسب عدد المستخدمين يفترض أن العمل يقوم به أشخاص. عندما يستبدل عميلك أربعة مقاعد بوكيل ذكي وطابور مهام، يصبح نموذج التسعير نفسه هو المخاطرة.',
      'الانتقال من التسعير بالمقعد إلى التسعير بالاستخدام ليس تعديلاً بسيطاً، بل إعادة بناء لأنظمة القياس والفوترة وعمولات فريق المبيعات في وقت واحد.',
    ],
  },
  {
    id: 'browser-agent-flake',
    slug: 'browser-agents-in-production',
    category: 'automation',
    keywords: ['browser automation', 'agents', 'reliability', 'flaky', 'selectors'],
    brokeHoursAgo: 30,
    momentum: 'steady',
    weight: 7,
    linkDomain: 'toolchain-weekly.example.com',
    headlines: {
      x: [
        'Browser agents demo at 95% and run at 60%. The gap is not the model, it is that real sites have cookie banners, A/B tests and a session that expires halfway through.',
        'Every browser automation failure I have debugged this year was a timing assumption, not a reasoning failure.',
        'If your browser agent has no notion of "I am not sure this click worked", it will confidently do the wrong thing at scale.',
        'The fix for flaky browser agents is boring: idempotent steps, explicit verification after every action, and a hard budget on retries.',
      ],
      reddit: [
        'Browser agents in production — what is your actual success rate?',
        'How do you handle a browser agent that silently does the wrong thing?',
        'Six months of browser automation: the failure modes nobody demos',
      ],
      hackernews: [
        'Browser agents fail in ways that look like success',
        'Show HN: A verification layer for browser automation steps',
      ],
      rss: [
        'Why browser agents are flaky in production and what actually helps',
        'The verification gap in browser automation',
        'From 60% to 90%: engineering reliability into browser agents',
      ],
    },
    bodies: [
      'A browser agent that fails loudly is a manageable problem. The dangerous case is the one where the agent believes it succeeded: it clicked something, the page changed, and the change was not the one intended. Without an explicit verification step the run continues on a false premise and every subsequent action compounds the error. The teams getting good numbers all added a check after each action asserting the observable state the action was supposed to produce.',
      'Our failure taxonomy after six months, in order of frequency: consent and cookie interstitials that appear only for some sessions, layout variants from A/B tests, session expiry mid-run, rate limiting disguised as a slow page, and last and rarest, the agent genuinely misreading the page. The model was the least of our problems.',
      'Retry budgets matter more than retry logic. An agent allowed to retry indefinitely will find a path through a broken flow that no human would take, and you will discover it in your support queue rather than your logs.',
    ],
    comments: [
      'The silent-success failure mode is the one that cost us money. We submitted the same form nine times because the confirmation selector had changed.',
      'We record a screenshot and the DOM hash after every step. Storage is cheap, debugging a run you cannot see is not.',
      'Rate limiting that presents as a slow page is evil and far more common than people expect.',
      'Anyone found a good way to test these? Our staging environment does not have the cookie banner, which is exactly the thing that breaks.',
      'Success rate is the wrong metric. We track cost per successful completion including the retries, and it changed our priorities completely.',
      'Idempotency keys on the target system saved us. If the site supports them, use them and stop trying to make the browser reliable.',
    ],
    arabic: [
      'وكلاء المتصفح يظهرون بنسبة نجاح عالية في العروض التقديمية، ثم تنخفض النسبة كثيراً في الإنتاج. السبب ليس النموذج، بل نوافذ الموافقة على الكوكيز وتغيّر التصميم وانتهاء الجلسة في منتصف المهمة.',
      'أخطر حالات فشل الأتمتة هي التي تبدو نجاحاً: الوكيل ضغط على شيء، وتغيّرت الصفحة، لكن التغيير لم يكن المقصود. بدون خطوة تحقق صريحة بعد كل إجراء، يستمر التنفيذ على أساس خاطئ.',
    ],
    repository: {
      owner: 'stepwise-tools',
      name: 'action-verifier',
      description:
        'Post-action verification and retry budgets for browser automation runs, with DOM snapshots per step.',
      language: 'TypeScript',
      topics: ['browser-automation', 'reliability', 'testing', 'agents'],
      releaseTag: 'v0.9.1',
      releaseTitle: 'v0.9.1 — retry budgets and consent interstitial handling',
      releaseNotes:
        'Adds a per-run retry budget so a stuck agent stops instead of finding a creative path through a broken flow. Consent and cookie interstitials are now detected and dismissed before the first assertion. Step snapshots are stored as DOM hashes plus an optional screenshot.',
    },
  },
  {
    id: 'silent-api-breakage',
    slug: 'apis-that-break-without-notice',
    category: 'apis',
    keywords: ['api', 'versioning', 'breaking change', 'integration', 'contract'],
    brokeHoursAgo: 96,
    momentum: 'fading',
    weight: 6,
    linkDomain: 'toolchain-weekly.example.com',
    headlines: {
      x: [
        'A field changed from a string to an object with no version bump and no changelog entry. Four hours of downtime later, this is why integration teams do not trust your API.',
        'Adding a field is not always backwards compatible. If a client validates strictly, and it should, your additive change is a breaking change.',
        'Every API needs one thing before it needs a v2: a changelog that a machine can read.',
        'Rate limits that change silently are breaking changes too. So are timeouts. So is response ordering that was never documented but everyone depended on.',
      ],
      reddit: [
        'A vendor changed a response field type with no notice and broke our production. How do you defend against this?',
        'What is your strategy for detecting upstream API changes before your customers do?',
        'Do you validate third party API responses strictly or loosely? Both have burned us',
      ],
      hackernews: [
        'Your additive API change broke my strict parser',
        'Contract testing against APIs you do not control',
      ],
      rss: [
        'The silent breaking change: when APIs shift under integrations',
        'Machine-readable changelogs and the end of surprise outages',
        'Defensive integration: assuming your upstream will change without telling you',
      ],
    },
    bodies: [
      'The failure is always the same shape. An upstream provider makes a change they consider minor — a field type widened, an enum gaining a member, a nullable that is now sometimes null in practice — and every downstream client with a strict parser fails at once. The provider sees no error on their side, so the incident is discovered by the customer. The only real defence is to treat every third-party response as untrusted input and to parse it explicitly rather than trusting a generated client.',
      'We now run a contract check against every upstream we depend on, hourly, in production. It requests a known-stable endpoint, validates the response against our schema, and pages nobody — it opens a ticket. In eight months it caught four changes before a customer did, which is four incidents that turned into a scheduled morning of work.',
      'The uncomfortable part of strict validation is deciding what to do when it fails. Rejecting the item is correct for a data pipeline and catastrophic for a payments flow. We ended up with per-field severity: unknown fields are logged, changed types on fields we read are fatal, and everything else degrades.',
    ],
    comments: [
      'Enum gaining a member is the one that gets everyone. Your parser is strict, their addition is additive, and you both think you are right.',
      'We keep a golden fixture of every upstream response and diff the live response against it nightly. Cheap and it works.',
      'The vendor response to this is always "it was in the changelog". It was in a blog post, three days after the deploy.',
      'Per-field severity is the right answer and almost nobody does it because it means writing the schema by hand.',
      'Generated clients feel productive until the generator and the API disagree about nullability.',
    ],
    arabic: [
      'تغيّر نوع أحد الحقول من نص إلى كائن دون تحديث للإصدار ودون أي إشعار، والنتيجة انقطاع للخدمة لساعات. هذا بالضبط سبب عدم ثقة فرق التكامل بواجهات برمجة التطبيقات.',
      'الحل الوحيد العملي هو التعامل مع كل استجابة خارجية كمدخل غير موثوق، والتحقق منها بمخطط صريح بدل الاعتماد على عميل مولَّد تلقائياً.',
    ],
  },
  {
    id: 'webhook-idempotency',
    slug: 'webhooks-versus-polling',
    category: 'apis',
    keywords: ['webhooks', 'idempotency', 'retries', 'queue', 'delivery'],
    brokeHoursAgo: 55,
    momentum: 'steady',
    weight: 6,
    linkDomain: 'retrieval-notes.example.com',
    headlines: {
      x: [
        'Webhooks are a queue you did not build, operated by someone who does not know your uptime target. Plan accordingly.',
        'If your webhook handler is not idempotent it is not a handler, it is a bug waiting for a duplicate delivery.',
        'The webhooks versus polling argument ends the moment you need ordering. Then it is polling with a cursor and everyone knows it.',
        'Signature verification, replay windows, idempotency keys, a dead letter queue. Four things. Every webhook integration that skipped one has a story.',
      ],
      reddit: [
        'Webhooks or polling in 2026? Genuinely torn for a payments integration',
        'How do you make webhook handlers idempotent when the event has no natural key?',
        'We lost 3 hours of events because our webhook endpoint returned 200 on failure',
      ],
      hackernews: [
        'Webhooks are a distributed systems problem in disguise',
        'Polling with a cursor is underrated',
      ],
      rss: [
        'Webhooks, retries and the idempotency you forgot to build',
        'Choosing between webhooks and polling for critical integrations',
        'Designing a webhook consumer that survives duplicate delivery',
      ],
    },
    bodies: [
      'Accepting a webhook is easy. Accepting a webhook exactly once, in order, with a provider who retries aggressively and considers any 2xx a success, is a distributed systems problem. The standard shape that works: verify the signature, persist the raw event with the provider event identifier as a unique key, return 200 immediately, and process asynchronously from your own queue. Any processing you do before returning 200 is processing that will be repeated.',
      'Ordering is the argument that settles the choice for many teams. Webhook providers rarely guarantee it, and a well-behaved consumer therefore has to tolerate an update arriving before the creation it depends on. If your domain cannot tolerate that, polling with a monotonic cursor is not the old-fashioned option, it is the correct one.',
      'The dead letter queue is the part teams skip and then rebuild during an incident. An event that fails processing five times needs somewhere to go that a human can look at, and it needs to be replayable without asking the provider to resend.',
    ],
    comments: [
      'Returning 200 before processing feels wrong the first time and is right every time.',
      'Our provider retries for 24 hours with exponential backoff and does not deduplicate. Without the unique key on the event id we would have double charged people.',
      'Events with no natural key: we hash the payload plus the delivery timestamp bucket. Not perfect but it caught 99% of duplicates.',
      'Polling with a cursor also means you can replay history whenever you want. That has saved us more than once.',
      'Nobody mentions clock skew. We had events arriving with timestamps three minutes in the future and our ordering logic just gave up.',
    ],
    arabic: [
      'الويب هوك في جوهره طابور مهام لم تبنه أنت، ويديره طرف لا يعرف أهداف الجاهزية لديك. تعامل معه على هذا الأساس.',
      'إذا لم يكن معالج الويب هوك لديك قابلاً للتكرار الآمن، فهو ليس معالجاً بل عطل ينتظر أول رسالة مكررة.',
    ],
  },
  {
    id: 'riyadh-cloud-region',
    slug: 'riyadh-cloud-region-data-residency',
    category: 'gulf',
    keywords: ['saudi arabia', 'cloud region', 'data residency', 'riyadh', 'compliance'],
    brokeHoursAgo: 8,
    momentum: 'breaking',
    weight: 10,
    linkDomain: 'gulf-tech-brief.example.com',
    headlines: {
      x: [
        'A local cloud region changes the sales conversation in Saudi more than any feature you could ship. Data residency stops being a six month exception process and becomes a checkbox.',
        'Every SaaS company selling into the Kingdom has the same slide about data residency. That slide is about to become one line instead of a paragraph.',
        'The region matters less for latency than for procurement. Public sector deals that were structurally impossible are now merely difficult.',
        'If you sell B2B software in the Gulf, your compliance page is now a competitive surface. Update it before your competitor does.',
      ],
      reddit: [
        'New cloud region in Riyadh — how much does this actually change selling into Saudi?',
        'Data residency requirements in the Gulf: what does your compliance stack look like?',
        'Anyone moved a production workload into a Saudi region yet? Looking for real numbers',
      ],
      hackernews: [
        'Data residency is a sales feature, not an infrastructure one',
        'Running a multi-region SaaS across the Gulf',
      ],
      rss: [
        'A cloud region in Riyadh and what it means for regional SaaS',
        'Data residency in the Gulf: from exception process to checkbox',
        'How local cloud capacity reshapes public sector software procurement in Saudi Arabia',
      ],
    },
    bodies: [
      'For most software companies selling into Saudi Arabia the blocker was never technical. It was that a customer with a residency requirement had to either accept an exception that took months to approve or wait for a local deployment that never came. A local region converts that into a deployment decision, which a competent team can make in a quarter. The commercial consequence is larger than the engineering one.',
      'The engineering work is real but bounded: a second control plane, region-pinned data stores, a routing layer that will not accidentally fail traffic across a boundary, and the operational discipline to keep backups inside the region too. The part that catches teams is the third-party dependencies — an analytics vendor or an email provider processing data outside the region reintroduces exactly the problem you set out to solve.',
      'Regional buyers are also asking harder questions than they were two years ago. Where is the data at rest, where is it processed, who on your team can access it, and can that be demonstrated rather than asserted. Answering those well is now a differentiator against larger competitors whose architecture cannot be explained in one page.',
    ],
    comments: [
      'The third-party dependency problem is the killer. Our own stack was compliant in a month, our vendors took a year.',
      'Latency improvement was nice but honestly irrelevant to the deal. The residency clause was the deal.',
      'Public sector procurement in the region has got noticeably faster where the residency question is already settled.',
      'Has anyone got a good template for the data flow diagram these RFPs ask for? Rewriting it per deal is exhausting.',
      'Do not underestimate the backup question. We passed every part of the review except where the snapshots lived.',
    ],
    arabic: [
      'منطقة سحابية محلية في الرياض تغيّر حديث المبيعات في السوق السعودي أكثر من أي ميزة تقنية. متطلب بقاء البيانات داخل المملكة يتحول من استثناء يستغرق شهوراً إلى بند بسيط في العقد.',
      'العمل الهندسي محدود وواضح: مستوى تحكم ثانٍ، قواعد بيانات مقيدة بالمنطقة، وطبقة توجيه لا تسمح بعبور الحدود. لكن ما يفاجئ الفرق هو مزوّدو الخدمات الخارجيون الذين يعالجون البيانات خارج المنطقة.',
      'المشترون في المنطقة صاروا يسألون أسئلة أدق: أين تُخزَّن البيانات، وأين تُعالَج، ومن يستطيع الوصول إليها من فريقكم، وهل يمكن إثبات ذلك عملياً لا الاكتفاء بالتصريح به.',
    ],
  },
  {
    id: 'arabic-dialect-benchmark',
    slug: 'arabic-dialect-evaluation',
    category: 'gulf',
    keywords: ['arabic', 'nlp', 'benchmark', 'dialect', 'evaluation'],
    brokeHoursAgo: 18,
    momentum: 'rising',
    weight: 8,
    linkDomain: 'gulf-tech-brief.example.com',
    headlines: {
      x: [
        'Most Arabic model evaluations test Modern Standard Arabic, which almost nobody writes in a support ticket. The dialect gap is the whole product problem.',
        'A model that scores well on formal Arabic and fails on Gulf dialect is not an Arabic model, it is a newspaper model.',
        'Built an evaluation set from real support conversations in Gulf dialect. Scores dropped by a third across every model we tried.',
        'Arabic evaluation needs dialect, code switching and Arabizi in the same test set, because that is what the input actually looks like.',
      ],
      reddit: [
        'Why is Arabic dialect evaluation still this bad?',
        'Building an Arabic support bot: MSA works, dialect does not. What are people doing?',
        'Anyone have an Arabic evaluation set that includes code switching?',
      ],
      hackernews: [
        'Arabic benchmarks measure the wrong Arabic',
        'Show HN: A dialect-aware Arabic evaluation harness',
      ],
      rss: [
        'The Arabic dialect gap in language model evaluation',
        'Why Gulf dialect breaks models that ace Modern Standard Arabic',
        'Code switching, Arabizi and the reality of Arabic user input',
      ],
    },
    bodies: [
      'The gap between formal Arabic and the Arabic people actually type is wide enough to invalidate most published evaluation numbers for product purposes. Support tickets, chat messages and social posts in the Gulf mix dialect, Modern Standard Arabic, English technical terms and Latin-script Arabizi, often inside a single sentence. A benchmark built from formal written sources measures none of that.',
      'We assembled an evaluation set of several thousand real support conversations, anonymised, spanning three dialect regions, and scored the models we were considering. Every model lost a substantial fraction of its formal-Arabic accuracy. More usefully, the errors were not uniform: negation and politeness markers were the most common failures, and both of them change the meaning of a support response completely.',
      'Code switching deserves its own treatment. When a user writes a sentence in dialect and drops in three English product terms, a model that translates the English terms into Arabic produces text that is technically correct and unreadable to the person who wrote the ticket. Terminology preservation is a product requirement, not a style preference.',
    ],
    comments: [
      'Negation errors in a support context are genuinely dangerous. "Your order was not shipped" and "your order was shipped" are one token apart.',
      'We keep English technical terms in Latin script deliberately. Every attempt to Arabise them made the output worse for developers.',
      'Arabizi is the part everyone forgets. A meaningful share of our inbound is Latin-script Arabic and most pipelines detect it as English.',
      'Is anyone publishing a dialect evaluation set openly? We would contribute ours if there was somewhere to put it.',
      'The politeness marker finding matches ours exactly. Formal register in the response reads as cold when the question was casual.',
    ],
    arabic: [
      'معظم اختبارات تقييم النماذج العربية تعتمد على الفصحى، بينما لا أحد يكتب تذكرة دعم فني بالفصحى. الفجوة بين اللهجة والفصحى هي المشكلة الحقيقية في المنتج.',
      'بنينا مجموعة تقييم من محادثات دعم حقيقية بالهجات الخليجية، فانخفضت دقة كل النماذج التي جربناها بشكل ملحوظ. الأخطاء الأكثر تكراراً كانت في النفي وفي صيغ التأدب، وكلاهما يقلب معنى الرد تماماً.',
      'التبديل اللغوي بين العربية والإنجليزية داخل الجملة الواحدة يحتاج معالجة خاصة. عندما يترجم النموذج المصطلحات التقنية إلى العربية، تصبح الإجابة صحيحة لغوياً وغير مفهومة للمستخدم.',
    ],
    repository: {
      owner: 'khaleej-nlp',
      name: 'dialect-eval',
      description:
        'Dialect-aware Arabic evaluation harness covering code switching, Arabizi and politeness registers.',
      language: 'Python',
      topics: ['arabic', 'nlp', 'evaluation', 'benchmark', 'dialects'],
      releaseTag: 'v0.3.0',
      releaseTitle: 'v0.3.0 — Arabizi detection and negation probes',
      releaseNotes:
        'Adds Latin-script Arabic detection so Arabizi input is no longer classified as English, plus a dedicated negation probe set after we found negation to be the most damaging error class in support contexts. Politeness register scoring is now reported separately from overall accuracy.',
    },
  },
  {
    id: 'gulf-open-banking',
    slug: 'gulf-open-banking-rules',
    category: 'gulf',
    keywords: ['fintech', 'open banking', 'regulation', 'gulf', 'licensing'],
    brokeHoursAgo: 60,
    momentum: 'steady',
    weight: 6,
    linkDomain: 'gulf-tech-brief.example.com',
    headlines: {
      x: [
        'Open banking rules in the Gulf are moving faster than the integrations. The licence is achievable; the bank-by-bank API quality is the actual project timeline.',
        'Every fintech founder in the region underestimates the same thing: the regulator is not the bottleneck, the sandbox availability is.',
        'Account aggregation across Gulf banks is currently five integrations wearing a trench coat and calling itself a standard.',
        'The licensing path is now documented well enough to plan around. That is genuinely new and genuinely underrated.',
      ],
      reddit: [
        'Open banking licensing in the Gulf — what does the timeline actually look like?',
        'Building account aggregation across Gulf banks: how bad are the APIs really?',
        'Fintech founders in the region: what surprised you about the regulatory process?',
      ],
      hackernews: [
        'Open banking integration quality varies more than the regulation does',
        'What building a regional fintech taught us about sandboxes',
      ],
      rss: [
        'Open banking in the Gulf: regulation is ahead of implementation',
        'The integration reality behind regional open banking rules',
        'Licensing, sandboxes and the fintech timeline in the Gulf',
      ],
    },
    bodies: [
      'The regulatory framework for open banking across several Gulf markets is now clear enough that a founder can plan a licensing path with reasonable confidence. What is not clear is how long the technical integration takes, because that depends on each institution’s implementation rather than on the rules. Teams consistently budget for the licence and underestimate the integration by a factor of two or three.',
      'Sandbox quality is the single best predictor of how long an integration will take. A sandbox that returns realistic error conditions, rate limits and edge-case account states lets a team build defensively from the start. A sandbox that only ever returns the happy path guarantees that every failure mode is discovered in production.',
      'Consent management is where the regulation and the product design meet, and it is harder than the API work. A user has to understand what they are granting, for how long, and be able to revoke it in a way the institution honours promptly. Getting that flow right is a genuine differentiator and it is not something you can retrofit.',
    ],
    comments: [
      'Sandbox that only returns the happy path is worse than no sandbox because it gives you false confidence.',
      'Consent revocation propagation times vary enormously between institutions and nobody documents them.',
      'We budgeted six weeks per bank integration and it was closer to fourteen for the first three.',
      'The licensing documentation genuinely improved in the last eighteen months. Credit where it is due.',
      'Anyone dealing with multi-currency account aggregation across the region? The normalisation alone is a project.',
    ],
    arabic: [
      'أنظمة الخدمات المصرفية المفتوحة في الخليج تتقدم أسرع من جاهزية التكامل التقني. الحصول على الترخيص ممكن، لكن جودة واجهات كل بنك على حدة هي ما يحدد الجدول الزمني الحقيقي.',
      'إدارة موافقة المستخدم هي النقطة التي تلتقي فيها اللوائح بتصميم المنتج، وهي أصعب من العمل التقني نفسه. يجب أن يفهم المستخدم ما الذي يمنحه، ولأي مدة، وأن يستطيع سحبه فعلياً.',
    ],
  },
  {
    id: 'founder-led-sales-ceiling',
    slug: 'founder-led-sales-ceiling',
    category: 'sales',
    keywords: ['sales', 'founder led sales', 'arr', 'hiring', 'gtm'],
    brokeHoursAgo: 44,
    momentum: 'steady',
    weight: 7,
    linkDomain: 'ledger-and-loop.example.com',
    headlines: {
      x: [
        'Founder-led sales works until it does not, and the failure looks like a great quarter followed by two bad ones because you were the only one selling.',
        'The first sales hire fails when the founder never wrote down why deals were won. You are not hiring a closer, you are hiring against an undocumented process.',
        'If you cannot lose a deal for a reason you can name, you do not have a sales process, you have charisma.',
        'Stop asking when to hire a salesperson. Ask whether anyone other than you has closed a deal end to end.',
      ],
      reddit: [
        'When did you stop doing founder-led sales, and what broke?',
        'First sales hire failed in 5 months. What did we do wrong?',
        'How do you document a sales process that only exists in the founder’s head?',
      ],
      hackernews: [
        'Founder-led sales does not scale, but it teaches you what does',
        'What we learned from firing our first sales hire',
      ],
      rss: [
        'The founder-led sales ceiling and how to see it coming',
        'Documenting the deal: what to write down before your first sales hire',
        'Why the first sales hire fails so often',
      ],
    },
    bodies: [
      'The founder-led sales ceiling is rarely a volume problem. It is that the founder carries the entire qualification model in their head — which prospects are serious, which objections are fatal, which requests to refuse — and none of it is written anywhere. A new salesperson inherits the pipeline without the model, works the wrong deals enthusiastically, and misses quota for reasons that look like performance and are actually onboarding.',
      'The most useful artefact we produced before hiring was a loss log. Every deal that did not close, with the real reason rather than the polite one. It was uncomfortable reading and it turned out to be a better training document than anything we wrote deliberately, because it made the disqualification criteria concrete.',
      'A reasonable test for readiness: can someone other than a founder run a full cycle, from first call to signature, without the founder joining a call? If the answer is no, the next hire will fail regardless of how good they are, and you will conclude you hired badly.',
    ],
    comments: [
      'The loss log idea is excellent and nobody does it because writing down the real reason you lost is painful.',
      'We hired a senior enterprise rep into a product with a two week sales cycle. Complete mismatch, entirely our fault.',
      'Founders also tend to sell to people like themselves. The first rep discovers the rest of the market and it is harder.',
      'Six months is not long enough to judge a sales hire in most B2B cycles, and most founders judge at four.',
      'What actually worked for us: the founder stayed on calls but stopped talking. Painful, effective.',
    ],
    arabic: [
      'البيع المباشر من المؤسس ينجح إلى حد معيّن، ثم يظهر الفشل على شكل ربع ممتاز يتبعه ربعان ضعيفان، لأنك كنت الشخص الوحيد الذي يبيع فعلاً.',
      'أفضل ما أنجزناه قبل أول تعيين في المبيعات كان سجلاً لأسباب خسارة الصفقات، بالأسباب الحقيقية لا المجاملة. تبيّن أنه أفضل مستند تدريبي كتبناه على الإطلاق.',
    ],
  },
  {
    id: 'email-deliverability-crackdown',
    slug: 'cold-email-deliverability',
    category: 'sales',
    keywords: ['email', 'deliverability', 'outbound', 'dmarc', 'cold email'],
    brokeHoursAgo: 12,
    momentum: 'rising',
    weight: 8,
    linkDomain: 'toolchain-weekly.example.com',
    headlines: {
      x: [
        'Deliverability tightened again and half the outbound industry is discovering that volume was never the strategy, it was the whole strategy.',
        'Your cold email problem is not the copy. It is that you send from a domain with no reputation to a list you did not verify.',
        'Authentication, warm-up, list hygiene, reply handling. Skip any one and your open rate is a fiction anyway.',
        'The teams unaffected by the deliverability changes are the ones who were already sending less to better lists. That is not a coincidence.',
      ],
      reddit: [
        'Cold email open rates collapsed this month. Is it us or is it everyone?',
        'Deliverability changes: what actually still works for outbound?',
        'How many sending domains is too many? Asking after our main domain got flagged',
      ],
      hackernews: [
        'Email authentication finally has teeth',
        'What the deliverability changes mean for small senders',
      ],
      rss: [
        'The deliverability crackdown and the end of volume outbound',
        'Authentication, reputation and why your cold email stopped landing',
        'List hygiene is the outbound strategy now',
      ],
    },
    bodies: [
      'The changes are not subtle and they were announced well in advance. Sending domains need proper authentication, complaint rates need to stay under a low threshold, and unsubscribe handling has to work in one click. Senders who treated these as optional have seen placement collapse, and the recovery path — warming a new domain slowly while fixing the underlying list quality — takes months rather than days.',
      'The interesting second-order effect is on tooling. A generation of outbound tools was built around the assumption that you could rotate domains and mailboxes to work around reputation. That assumption is now expensive. The tools surviving the transition are the ones focused on list quality and reply handling rather than throughput.',
      'For teams with a genuinely relevant offer the picture is better than it looks. Lower total volume across the industry means less competition in the inbox, and a well-authenticated domain sending a modest number of relevant messages now stands out more than it did a year ago.',
    ],
    comments: [
      'We cut volume by 80% and booked more meetings. I did not expect that and I am still slightly annoyed about it.',
      'One-click unsubscribe handling is the thing most tools implemented badly. Check yours actually processes the header.',
      'Domain rotation as a strategy is dead and honestly good riddance.',
      'Our complaint rate was fine on average and terrible on one segment. Averages hide the account that gets you flagged.',
      'Warming a domain properly takes six weeks minimum. Everyone tries to do it in one and wonders why it failed.',
    ],
    arabic: [
      'تشددت قواعد وصول البريد الإلكتروني مجدداً، واكتشف نصف العاملين في التواصل الخارجي أن الحجم لم يكن استراتيجية مساندة بل كان الاستراتيجية كاملة.',
      'خفّضنا حجم الرسائل بشكل كبير وحجزنا اجتماعات أكثر. النتيجة كانت مفاجئة، ودرسها أن جودة القائمة أهم من عدد الرسائل.',
    ],
  },
  {
    id: 'analytics-repatriation',
    slug: 'bringing-analytics-in-house',
    category: 'saas',
    keywords: ['analytics', 'cost', 'self hosted', 'warehouse', 'vendor'],
    brokeHoursAgo: 110,
    momentum: 'fading',
    weight: 5,
    linkDomain: 'signal-and-stack.example.com',
    headlines: {
      x: [
        'Teams are pulling analytics back in-house and the reason is boring: the bill scales with events and the value does not.',
        'Self-hosting analytics is cheap until you count the engineer who maintains it. Then it is a trade, not a saving.',
        'The analytics vendor bill is the easiest line item to cut and the hardest one to cut correctly.',
        'We moved product analytics into our warehouse and kept exactly two dashboards. Nobody has asked for the other forty.',
      ],
      reddit: [
        'Moved analytics in-house to cut costs — six months later, was it worth it?',
        'Our analytics vendor bill tripled with flat usage. What are the realistic alternatives?',
        'How many of your analytics dashboards does anyone actually look at?',
      ],
      hackernews: [
        'We replaced our analytics vendor with the warehouse we already paid for',
        'The true cost of self-hosted analytics',
      ],
      rss: [
        'Analytics repatriation: the cost case and the hidden bill',
        'Why teams are moving product analytics into the warehouse',
        'Two dashboards out of forty: what analytics consolidation revealed',
      ],
    },
    bodies: [
      'Event-priced analytics has a structural problem: the price scales with instrumentation, and good instrumentation is exactly what a growing product adds. Teams end up either paying more each quarter for the same insight or deliberately under-instrumenting to control the bill, which defeats the purpose. Moving the pipeline into a warehouse the company already runs changes the cost shape from per-event to per-query.',
      'The honest accounting includes the maintenance. Someone owns the ingestion pipeline, someone fixes the schema when a product team adds an event badly, and someone answers the question that a vendor dashboard used to answer in a click. For a team of thirty engineers that overhead is easily absorbed. For a team of five it is not.',
      'The unexpected benefit was consolidation. Rebuilding meant deciding which dashboards were worth rebuilding, and the answer was a small fraction of what existed. Most dashboards are built for a single decision and then never deleted.',
    ],
    comments: [
      'The under-instrumenting-to-save-money failure mode is real and nobody admits to it in public.',
      'We kept the vendor for session replay and moved everything else. Best of both, honestly.',
      'Warehouse costs are not zero either. Our query bill went up more than we modelled.',
      'Deleting dashboards nobody uses is the highest leverage thing I did all year.',
      'If you have a data team already this is easy. If you do not, you are hiring one, just without saying so.',
    ],
    arabic: [
      'الفرق تعيد أدوات التحليلات إلى داخل بنيتها التحتية، والسبب بسيط: الفاتورة تكبر مع عدد الأحداث بينما القيمة لا تكبر معها.',
      'إعادة البناء أجبرتنا على تحديد أي لوحات المعلومات تستحق فعلاً، وكانت الإجابة نسبة صغيرة جداً مما كان موجوداً.',
    ],
  },
  {
    id: 'postgres-as-queue',
    slug: 'postgres-instead-of-a-broker',
    category: 'automation',
    keywords: ['postgres', 'queue', 'jobs', 'infrastructure', 'skip locked'],
    brokeHoursAgo: 70,
    momentum: 'steady',
    weight: 6,
    linkDomain: 'toolchain-weekly.example.com',
    headlines: {
      x: [
        'You probably do not need a message broker. You need a table, an index, and SELECT FOR UPDATE SKIP LOCKED. The operational savings are enormous.',
        'The case for a queue in your database: transactional enqueue. Being able to insert a job in the same transaction as the row that caused it removes an entire class of bug.',
        'Postgres as a queue works fine into the low thousands of jobs per second. Almost nobody in this thread is above that.',
        'The moment to move off a database-backed queue is when the queue traffic starts hurting your primary workload, not before.',
      ],
      reddit: [
        'Postgres as a job queue — where does it actually break down?',
        'We moved from a broker back to Postgres for jobs. Ask me anything',
        'Transactional enqueue is the feature I did not know I was missing',
      ],
      hackernews: [
        'SKIP LOCKED is enough queue for most applications',
        'We ran our job queue on Postgres for three years',
      ],
      rss: [
        'Postgres as a job queue: when it works and when it stops working',
        'Transactional enqueue and the bugs it eliminates',
        'Choosing between a database-backed queue and a dedicated broker',
      ],
    },
    bodies: [
      'The decisive argument for a database-backed queue is not simplicity, it is transactionality. When a job is enqueued in the same transaction as the state change that requires it, the two can never disagree. With an external broker you are choosing between publishing before commit, which can produce a job for work that rolled back, and publishing after, which can lose the job entirely — and the usual fix is an outbox table, at which point you are running a queue in your database anyway.',
      'The operational profile is the other half. A broker is another thing to monitor, upgrade, secure and reason about during an incident. For teams under a certain size that overhead is a genuine tax, and the throughput they are buying with it is throughput they will not use for years, if ever.',
      'The signal that it is time to move is specific: when queue polling or job table bloat starts affecting the latency of your main application queries. Watch for that rather than for a job-per-second number, because the number that matters depends entirely on your workload.',
    ],
    comments: [
      'The outbox pattern argument is the one that convinced me. If you are building an outbox you already have a queue in your database.',
      'Vacuum on a high-churn job table is the thing that catches people. Partition it or you will find out the hard way.',
      'We are at 800 jobs per second on Postgres and it is completely unremarkable.',
      'Long-running jobs are the awkward case. Holding a row lock for ten minutes is not what SKIP LOCKED is for.',
      'Dedicated brokers give you fan-out and delivery semantics you would have to build. Worth it if you need them, wasteful if you do not.',
    ],
    arabic: [
      'غالباً لا تحتاج إلى وسيط رسائل مستقل. تحتاج جدولاً وفهرساً وجملة قفل تتخطى الصفوف المقفلة. التوفير في العبء التشغيلي كبير جداً.',
      'الحجة الحاسمة ليست البساطة بل إمكانية إدراج المهمة داخل المعاملة نفسها التي أنتجتها، وهذا يلغي فئة كاملة من الأخطاء.',
    ],
    repository: {
      owner: 'sandbar-systems',
      name: 'pgjobs',
      description:
        'Transactional job queue for PostgreSQL using SKIP LOCKED, with partitioned job tables and backoff.',
      language: 'Go',
      topics: ['postgres', 'queue', 'jobs', 'background-jobs'],
      releaseTag: 'v2.1.0',
      releaseTitle: 'v2.1.0 — partitioned job tables',
      releaseNotes:
        'Job tables are now partitioned by completion date, which keeps vacuum predictable on high-churn workloads and makes retention a partition drop instead of a delete. Adds a lease renewal API for long-running jobs so a worker no longer holds a row lock for the whole execution.',
    },
  },
  {
    id: 'support-deflection-numbers',
    slug: 'ai-support-deflection-reality',
    category: 'saas',
    keywords: ['support', 'deflection', 'ai agents', 'customer service', 'metrics'],
    brokeHoursAgo: 26,
    momentum: 'rising',
    weight: 8,
    linkDomain: 'signal-and-stack.example.com',
    headlines: {
      x: [
        'Support deflection numbers are mostly measurement artefacts. If a customer gives up and does not open a ticket, your dashboard records a win.',
        'The honest support metric is resolution without a follow-up contact within seven days. Everything shorter than that flatters you.',
        'We measured AI support deflection properly and it was half the vendor number. The half that was real was still worth it.',
        'Deflection is the wrong goal. Time to resolution is the goal, and sometimes the fastest resolution is routing to a human in ten seconds.',
      ],
      reddit: [
        'What is your real AI support deflection rate, measured honestly?',
        'How are you measuring deflection without counting abandonment as success?',
        'Rolled out an AI support agent — CSAT dropped but ticket volume dropped more. Now what?',
      ],
      hackernews: [
        'Support deflection metrics measure abandonment',
        'Measuring AI support quality without lying to yourself',
      ],
      rss: [
        'The measurement problem inside AI support deflection',
        'Deflection, abandonment and the metric that actually matters',
        'What honest AI support numbers look like',
      ],
    },
    bodies: [
      'Deflection is usually computed as the share of conversations that ended without a human agent. That definition counts three very different outcomes identically: the customer got a correct answer, the customer got a wrong answer and did not realise, and the customer gave up. Only the first is a success, and the naive metric cannot distinguish them. A follow-up window is the cheapest correction — if the same customer contacts support again about the same issue within a week, the original conversation was not resolved.',
      'When we recomputed with a seven day follow-up window our deflection rate roughly halved. That was uncomfortable to present and it was the right number. It also changed what we optimised: the biggest gains came not from making the agent smarter but from making it escalate faster when confidence was low.',
      'The other measurement people skip is segment breakdown. An aggregate deflection rate hides the fact that the agent handles password resets brilliantly and billing disputes terribly, and the billing disputes are the ones that generate churn.',
    ],
    comments: [
      'Counting abandonment as deflection is the industry standard and everyone knows it.',
      'Fast escalation improved our numbers more than any prompt change. Confidence thresholds are underrated.',
      'CSAT went down while volume went down. Turned out the agent was great at easy tickets so humans only ever saw hard ones. Our human CSAT was being compared unfairly.',
      'Segment breakdown is essential. Aggregate numbers in support are almost always misleading.',
      'Seven days is a good window for us. For an annual billing product it should probably be longer.',
    ],
    arabic: [
      'أرقام تحويل تذاكر الدعم إلى حلول آلية مضللة في الغالب. إذا استسلم العميل ولم يفتح تذكرة، تسجّل لوحة المؤشرات ذلك نجاحاً.',
      'المقياس الصادق هو حل المشكلة دون تواصل متابعة خلال أسبوع. عندما أعدنا الحساب بهذه الطريقة انخفضت النسبة إلى النصف تقريباً، وكان ذلك هو الرقم الصحيح.',
    ],
  },
  {
    id: 'seed-round-revenue-bar',
    slug: 'seed-rounds-want-revenue',
    category: 'startups',
    keywords: ['fundraising', 'seed round', 'revenue', 'investors', 'traction'],
    brokeHoursAgo: 130,
    momentum: 'fading',
    weight: 5,
    linkDomain: 'ledger-and-loop.example.com',
    headlines: {
      x: [
        'The seed round bar moved and nobody sent a memo. Investors want revenue at the stage that used to fund finding out whether revenue was possible.',
        'If seed requires traction, pre-seed has to fund the search for traction, and mostly it does not. That gap is where good companies die.',
        'Raising on a deck is not dead, it is just reserved for people who have done it before.',
        'The practical response to a higher seed bar is a smaller first cheque and a longer runway to a revenue milestone. Less romantic, works.',
      ],
      reddit: [
        'Has the seed round bar actually moved or does it just feel that way?',
        'Raising seed with 8k MRR and no growth story. What are our real options?',
        'Investors keep asking for a metric we cannot have yet. How do you handle that conversation?',
      ],
      hackernews: [
        'The seed stage now expects what Series A used to',
        'Bootstrapping to the metric investors want',
      ],
      rss: [
        'The seed round bar has moved: what founders are seeing',
        'When seed capital expects revenue, who funds the search?',
        'Adapting a fundraising plan to a higher traction bar',
      ],
    },
    bodies: [
      'Founders raising a first institutional round consistently report being asked for revenue metrics that a few years ago belonged to a later stage. The stated requirement varies but the direction does not. The structural consequence is that the risk previously carried by seed investors — does anyone want this — has shifted onto founders and the earliest angels, who are the least equipped to carry it.',
      'The practical adaptations are unglamorous and effective. Raise a smaller first amount at a lower valuation to buy time rather than status. Pick a single revenue milestone and design the next twelve months entirely around reaching it. And treat consulting or services revenue as legitimate runway rather than a mark of failure, provided it does not consume the team.',
      'There is a counter-current worth noting. Investors who specialise in the earliest stage have not moved their bar, because moving it would eliminate their entire strategy. The bar has moved most at funds that expanded into seed from later stages and are now retreating to their original thesis.',
    ],
    comments: [
      'The risk shifted onto founders and nobody says it out loud. Pre-seed is doing the job seed used to do with a tenth of the capital.',
      'Services revenue kept us alive for a year and every investor asked about it apologetically. It was the smartest thing we did.',
      'Specialist pre-seed funds genuinely have not moved. It is the tourists who left.',
      'Smaller round at a lower valuation is right but it is a hard sell to a co-founder who read the 2021 headlines.',
      'We picked one milestone and refused everything else for nine months. Boring, worked.',
    ],
    arabic: [
      'ارتفع سقف متطلبات الجولة التأسيسية دون إعلان رسمي. المستثمرون يطلبون إيرادات في المرحلة التي كانت مخصصة أصلاً لاكتشاف ما إذا كانت الإيرادات ممكنة.',
      'الاستجابة العملية غير مثيرة لكنها فعالة: جولة أصغر بتقييم أقل لشراء الوقت، وهدف إيرادي واحد يُبنى حوله العام القادم بالكامل.',
    ],
  },
];
