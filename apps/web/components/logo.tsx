export function LogoMark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="var(--accent)" />
      <path
        d="M6.5 8.5h11M6.5 12h11M6.5 15.5h11"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9.5 6v12M14.5 6v12"
        stroke="#fff"
        strokeOpacity="0.5"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">weft</span>
    </span>
  );
}
