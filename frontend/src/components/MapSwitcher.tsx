import { cn } from '@/lib/utils'

export type BaseMap = 'none' | 'osm' | 'satellite' | 'google3d'

const OPTIONS: { value: BaseMap; label: string }[] = [
  { value: 'none',      label: 'None' },
  { value: 'osm',       label: 'OSM' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'google3d',  label: 'Google 3D' },
]

interface Props {
  value: BaseMap
  onChange: (v: BaseMap) => void
}

export function MapSwitcher({ value, onChange }: Props) {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex rounded-xl overflow-hidden
                    border border-white/[0.07] bg-[#080c18]/80 backdrop-blur-md shadow-lg">
      {OPTIONS.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'h-8 px-3 text-xs font-medium transition-all duration-200 select-none',
            v === value
              ? 'bg-[#86B735]/20 text-[#a3d44a]'
              : 'text-white/65 hover:text-white/90 hover:bg-white/[0.07]',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
