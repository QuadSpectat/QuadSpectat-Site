import { cn } from '@/lib/utils'

export type BaseMap = 'none' | 'osm' | 'satellite' | 'google3d'

const OPTIONS: { value: BaseMap; label: string; shortLabel: string }[] = [
  { value: 'none',      label: 'None',      shortLabel: 'None' },
  { value: 'osm',       label: 'OSM',       shortLabel: 'OSM' },
  { value: 'satellite', label: 'Satellite', shortLabel: 'Sat' },
  { value: 'google3d',  label: 'Google 3D', shortLabel: 'G3D' },
]

interface Props {
  value: BaseMap
  onChange: (v: BaseMap) => void
  /** Render as a segmented control in a header (not floating over the map). */
  inline?: boolean
}

export function MapSwitcher({ value, onChange, inline = false }: Props) {
  return (
    <div
      role="group"
      aria-label="Base map"
      className={cn(
        inline
          ? 'flex rounded-xl border border-border bg-background p-[3px] gap-0.5 shrink-0'
          : 'absolute bottom-4 right-4 z-10 flex rounded-xl overflow-hidden border border-white/[0.07] bg-[#090d0b]/80 backdrop-blur-md shadow-lg',
      )}
    >
      {OPTIONS.map(({ value: v, label, shortLabel }) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn(
            'h-8 px-3 text-xs font-medium transition-all duration-200 select-none',
            inline && 'rounded-lg',
            v === value
              ? inline
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'bg-[#9ACD3C]/20 text-[#b8e05c]'
              : 'text-white/65 hover:text-white/90 hover:bg-white/[0.07]',
          )}
        >
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{shortLabel}</span>
        </button>
      ))}
    </div>
  )
}
