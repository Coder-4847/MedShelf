export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <g transform="rotate(-40 32 30)">
        <rect x="13" y="22" width="38" height="16" rx="8" fill="var(--accent-fg)" />
        <path d="M32 22h11a8 8 0 0 1 0 16H32z" fill="var(--accent-fg)" fillOpacity=".5" />
        <rect x="31" y="22" width="2" height="16" fill="var(--accent)" />
      </g>
      <rect x="14" y="48" width="36" height="3.5" rx="1.75" fill="var(--accent-fg)" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={30} />
      <span className="text-[19px] font-semibold tracking-tight text-fg">
        Med<span className="text-accent">Shelf</span>
      </span>
    </span>
  )
}
