import { useAuth } from '../hooks/useAuth';
import { EyeIcon } from '@heroicons/react/24/outline';

export default function ImpersonationBanner() {
  const { impersonation, stopImpersonation } = useAuth();

  if (!impersonation) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-amber-500 px-5 py-2.5 text-[13px] font-medium text-white shadow-lg">
      <EyeIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="whitespace-nowrap">
        Viewing as <strong>{impersonation.userName}</strong> ({impersonation.userRole}) — read-only
      </span>
      <button
        onClick={stopImpersonation}
        className="rounded-full bg-white/20 px-3 py-0.5 text-[12px] font-semibold transition-colors hover:bg-white/30"
      >
        Exit
      </button>
    </div>
  );
}
