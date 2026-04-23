import { STATUS_BADGE, STATUS_LABEL, ROLE_BADGE } from '../../lib/constants';

type BadgeType = 'status' | 'role' | 'custom';

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
  }

  const display =
    type === 'status'
        ? STATUS_LABEL[value as keyof typeof STATUS_LABEL] || value
        : value;

  return (
    <span className={`led-chip ${colorClass} ${className}`}>
      {type === 'status' && <span className="led-chip-dot" />}
      {display}
    </span>
  );
}
