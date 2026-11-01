import type { ReactNode } from 'react';
import { Banknote, CreditCard, Link2, Smartphone, Zap } from 'lucide-react';
import type { CollectionMethod } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { money, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, StateBadge, type BadgeTone } from '@/components/ui';
import './i18n';

/** Money in piasters, always LTR inside Arabic text. */
export function Amount({ cents, className, sign }: { cents: number | null | undefined; className?: string; sign?: boolean }) {
  return <span className={cn('ltr inline-block tabular-nums', className)}>{money(cents ?? 0, { sign })}</span>;
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ltr inline-block', className)}>{children}</span>;
}

/** 1250 g → "1.25 kg" (localised digits). */
export function Kg({ grams, className }: { grams: number | null | undefined; className?: string }) {
  const { t } = useI18n();
  if (grams === null || grams === undefined) return <span className={className}>—</span>;
  return <span className={cn('ltr inline-block tabular-nums', className)}>{t('money.kg', { n: num(Math.round(grams / 10) / 100) })}</span>;
}

export const METHOD_ICON: Record<CollectionMethod, ReactNode> = {
  CASH: <Banknote className="h-4 w-4" />,
  INSTAPAY: <Zap className="h-4 w-4" />,
  WALLET: <Smartphone className="h-4 w-4" />,
  CARD: <CreditCard className="h-4 w-4" />,
  PAYMENT_LINK: <Link2 className="h-4 w-4" />,
};

export function MethodBadge({ method }: { method: CollectionMethod | null }) {
  const { t } = useI18n();
  if (!method) return <span className="text-ink-400">—</span>;
  return (
    <Badge tone={method === 'CASH' ? 'cash' : 'info'}>
      {METHOD_ICON[method]}
      {t(`money.method.${method}`)}
    </Badge>
  );
}

const TONES: Record<string, BadgeTone> = {
  PENDING_CONFIRMATION: 'warning', CONFIRMED: 'success', REJECTED: 'danger', NOT_APPLICABLE: 'neutral',
  REQUESTED: 'warning', APPROVED: 'progress', PAID: 'success', RECOVERED: 'success', CANCELLED: 'neutral',
  OPEN: 'warning', UNDER_REVIEW: 'progress',
  NONE: 'neutral', ADJUSTED: 'warning', DISPUTED: 'danger', ACCEPTED: 'neutral', REVERSED: 'success',
};

/** Status badge for collections, advances, claims and weight adjustments. */
export function MoneyState({ value }: { value: string }) {
  return <StateBadge value={value} map={TONES} />;
}

/** "1 %" from basis points. */
export function Bp({ bp }: { bp: number }) {
  return <span className="ltr inline-block">{num(bp / 100)}%</span>;
}
