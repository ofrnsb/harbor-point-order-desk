// The product mark: two strands tied into one knot. While the agent works, the strands draw around the knot.
export function Mark({ size = 24, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <svg className="ap-mark sp-mark" data-busy={busy} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path className="sp-mark-a" d="M3.5 8.5c4.5 0 6 7 10.5 7s6.5-3.2 6.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path className="sp-mark-b" d="M3.5 15.5c4.5 0 6-7 10.5-7s6.5 3.2 6.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}
