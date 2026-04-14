import { STATUS_BADGE, STATUS_LABEL, ROLE_BADGE, KYC_CONFIG } from '../../lib/constants';

type BadgeType = 'status' | 'role' | 'kyc' | 'custom';

interface BadgeProps {
  type?: BadgeType;
  value: string;
  className?: string;
}

export default function Badge({ type = 'status', value, className = '' }: BadgeProps) {
  let colorClass = 'bg-muted text-muted-foreground';

  if (type === 'status') {
    colorClass = STATUS_BADGE[value as keyof typeof STATUS_BADGE] || colorClass;
  } else if (type === 'role') {
    colorClass = ROLE_BADGE[value as keyof typeof ROLE_BADGE] || colorClass;
  } else if (type === 'kyc') {
    const kyc = KYC_CONFIG[value as keyof typeof KYC_CONFIG];
    colorClass = kyc ? `${kyc.bg} ${kyc.color}` : colorClass;
  }

  const display =
    type === 'kyc'
      ? KYC_CONFIG[value as keyof typeof KYC_CONFIG]?.label || value
      : type === 'status'
        ? STATUS_LABEL[value as keyof typeof STATUS_LABEL] || value
        : value;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium capitalize ${colorClass} ${className}`}>
      {display}
    </span>
  );
}
