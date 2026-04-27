import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PlanData {
  name: string;
  credits_per_month: number;
  interval: number;
  price_cents: number;
  interval_label: string;
  max_security_level: number;
  supports_hipaa: boolean;
  audit_retention_days: number;
}

interface PlanDetailsCardProps {
  plan: PlanData;
}

function formatPrice(cents: number, intervalLabel: string): string {
  if (cents === 0 && intervalLabel !== 'one-time') return '$0/mo';
  if (cents === 0) return 'Free';

  const dollars = cents / 100;
  const formatted = dollars === Math.floor(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;

  switch (intervalLabel) {
    case 'one-time': return formatted;
    case 'monthly': return `${formatted}/mo`;
    case 'annual': return `${formatted}/yr`;
    default: return `${formatted}/${intervalLabel}`;
  }
}

function formatCredits(credits: number, intervalLabel: string): string {
  const formatted = credits.toLocaleString();
  const suffix = intervalLabel === 'monthly' || intervalLabel === 'annual' ? '/mo' : '';
  return `${formatted} credits${suffix}`;
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-green-600"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function PlanDetailsCard({ plan }: PlanDetailsCardProps) {
  const features: string[] = [];

  if (plan.credits_per_month > 0) {
    features.push(formatCredits(plan.credits_per_month, plan.interval_label));
  } else {
    features.push('Purchase credits as needed');
  }

  if (plan.max_security_level >= 99) {
    features.push('High security level');
  }
  if (plan.supports_hipaa) {
    features.push('HIPAA compliance');
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-lg">{plan.name}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {formatPrice(plan.price_cents, plan.interval_label)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm text-foreground">
              <CheckIcon />
              {feature}
            </li>
          ))}
        </ul>
        <div>
          <a
            href="/pricing"
            className="text-sm font-medium text-foreground hover:underline"
          >
            Change plan &rarr;
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
