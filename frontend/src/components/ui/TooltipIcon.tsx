import { useState } from 'react';

interface TooltipIconProps {
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
}

export function TooltipIcon({ text, side = 'right', delay = 200 }: TooltipIconProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [hideTimer, setHideTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    const timer = setTimeout(() => setShowTooltip(true), delay);
    setHideTimer(timer);
  };

  const handleMouseLeave = () => {
    if (hideTimer) clearTimeout(hideTimer);
    setShowTooltip(false);
  };

  const positionClass = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
  }[side];

  const arrowClass = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-[var(--led-ink)] border-l-transparent border-r-transparent border-b-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-[var(--led-ink)] border-t-transparent border-b-transparent border-l-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--led-ink)] border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[var(--led-ink)] border-t-transparent border-b-transparent border-r-transparent',
  }[side];

  return (
    <div className="relative inline-flex" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--led-accent-tint)] text-[10px] font-bold text-[var(--led-accent)] hover:bg-[var(--led-accent)] hover:text-[var(--led-accent-ink)] transition-colors"
        title={text}
      >
        ?
      </button>
      {showTooltip && (
        <div
          className={`absolute z-50 w-48 rounded-lg bg-[var(--led-ink)] p-2 text-[12px] text-white shadow-lg pointer-events-none ${positionClass}`}
          style={{ animation: 'fadeIn 0.2s ease-in-out' }}
        >
          {text}
          <div className={`absolute w-0 h-0 border-4 ${arrowClass}`} />
        </div>
      )}
    </div>
  );
}
