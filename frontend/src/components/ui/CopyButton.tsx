import { useState } from 'react';
import { useToast } from './Toast';

interface CopyButtonProps {
  text: string;
  label?: string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function CopyButton({ text, label = 'Copy', size = 'md', showLabel = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast('Copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast('Failed to copy', 'error');
    }
  };

  const sizeClasses = {
    sm: 'h-6 w-6 text-[11px]',
    md: 'h-7 w-7 text-[12px]',
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center justify-center rounded-md transition-all ${
        size === 'sm' ? 'p-1' : 'p-1.5'
      } ${
        copied
          ? 'bg-[var(--led-success-tint)] text-[var(--led-success)]'
          : 'bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:bg-[var(--led-accent-tint)] hover:text-[var(--led-accent)]'
      }`}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? (
        <svg className={`${sizeClasses[size]}`} fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      ) : (
        <svg className={`${sizeClasses[size]}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.216 0-2.25 1.034-2.25 2.25v.894m7.5 0a2.25 2.25 0 100-4.5H5.25A2.25 2.25 0 003 4.5v15A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V4.5m-15 6.5h.008v.008H6.75m.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm.375 5.5h.008v.008H12m.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      )}
      {showLabel && <span className="ml-1 text-[11px] font-medium">{copied ? 'Copied' : label}</span>}
    </button>
  );
}
