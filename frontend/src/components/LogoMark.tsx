/** QuadSpectat contour mark: round badge with two contour lines and a centre point. */
export function LogoMark({ size = 32, filled = false, className }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className={className}>
      {filled
        ? <circle cx="14" cy="14" r="13" fill="#17201a" />
        : <circle cx="14" cy="14" r="12.5" fill="none" stroke="#9acd3c" strokeWidth="1.5" />}
      <path d="M4 17 Q10 9 14 14 T24 11" fill="none" stroke="#9acd3c" strokeWidth="1.4" />
      <path d="M5 21 Q11 14 15 18 T23 16" fill="none" stroke="#9acd3c" strokeOpacity=".6" strokeWidth="1.2" />
      <circle cx="14" cy="14" r="2" fill="#9acd3c" />
    </svg>
  )
}
