import { Progress } from '@trendhunter/ui';
import { getFormatter } from 'next-intl/server';

export interface ScoreMeterProps {
  readonly label: string;
  /** 0..100. */
  readonly value: number;
  readonly tone?: 'primary' | 'blue' | 'purple';
}

const TONE_CLASS = {
  primary: 'bg-primary',
  blue: 'bg-accent-blue',
  purple: 'bg-accent-purple',
} as const;

/**
 * A 0..100 score as a bar and a number.
 *
 * The number is always shown next to the bar. A bar alone asks the reader to
 * estimate a value from a length, which is exactly the judgement these scores
 * exist to spare them.
 */
export async function ScoreMeter({ label, value, tone = 'primary' }: ScoreMeterProps) {
  const format = await getFormatter();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-medium">
          {format.number(value, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <Progress value={value} aria-label={label} indicatorClassName={TONE_CLASS[tone]} />
    </div>
  );
}
