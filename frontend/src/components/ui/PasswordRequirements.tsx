import { CheckIcon } from '@heroicons/react/24/outline';
export const PASSWORD_REQUIREMENTS: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p) => /[0-9]/.test(p) },
];

export function passwordMeetsRequirements(p: string): boolean {
  return PASSWORD_REQUIREMENTS.every(r => r.test(p));
}

export default function PasswordRequirements({ password, alwaysShow = false }: { password: string; alwaysShow?: boolean }) {
  if (!password && !alwaysShow) return null;
  return (
    <ul className="mt-2.5 space-y-1">
      {PASSWORD_REQUIREMENTS.map(r => {
        const ok = !!password && r.test(password);
        return (
          <li key={r.label} className={`flex items-center gap-1.5 text-[12px] transition-colors duration-200 ${ok ? 'text-success' : 'text-muted-foreground'}`}>
            <CheckIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={ok ? 3 : 1.5} />
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
