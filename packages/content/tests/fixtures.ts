import type { GenerationContext } from '@trendhunter/types';

export const ENGLISH_CONTEXT: GenerationContext = {
  topicName: 'Autonomous coding agents in production',
  topicSummary:
    'Three teams reported running coding agents against their own repositories for a full sprint. Two cut review time; one reverted after a dependency upgrade went wrong.',
  sourceExcerpts: [
    'We let the agent open 40 pull requests in a week and merged 31 of them.',
    'The failure mode is not bad code, it is confidently wrong migrations.',
    'Latency per task dropped from 9 minutes to 40 seconds after we cached the repository index.',
  ],
  interests: ['AI agents', 'developer tooling', 'startups'],
  arabicOpportunityScore: 88,
};

export const ARABIC_CONTEXT: GenerationContext = {
  topicName: 'وكلاء البرمجة المستقلون في بيئة الإنتاج',
  topicSummary: 'ثلاثة فرق شغّلت وكلاء برمجة على مستودعاتها لمدة أسبوعين، واثنان منها خفّضا زمن المراجعة.',
  sourceExcerpts: ['خفضنا زمن المهمة من تسع دقائق إلى أربعين ثانية بعد تخزين فهرس المستودع.'],
  interests: ['وكلاء الذكاء الاصطناعي', 'أدوات المطورين'],
  arabicOpportunityScore: 94,
};

export const EMPTY_CONTEXT: GenerationContext = {
  topicName: '',
  topicSummary: null,
  sourceExcerpts: [],
  interests: [],
  arabicOpportunityScore: null,
};
