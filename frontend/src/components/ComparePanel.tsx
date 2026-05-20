import { useState } from 'react'
import { GitCompareArrows, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WheelSlider } from '@/components/WheelSlider'
import type { Model } from '@/lib/api'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'

export interface OrthoCompare {
  beforeId: string
  afterId: string
  blend: number
}

interface Props {
  models: Model[]
  selectedModel: Model | null
  orthophotos: ResolvedOrthophoto[]
  overlayModel: Model | null
  compareBlend: number
  orthoCompare: OrthoCompare | null
  onOverlayModelChange: (model: Model | null) => void
  onCompareBlendChange: (blend: number) => void
  onOrthoCompareChange: (compare: OrthoCompare | null) => void
}

const PANEL = 'rounded-2xl border border-white/[0.15] bg-[#0a0e1a]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80'

function BlendSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative h-4 flex items-center group/sl">
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
      <div
        className="absolute left-0 h-[3px] rounded-full bg-[#86B735]/85"
        style={{ width: `${value * 100}%` }}
      />
      <div
        className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md ring-[1.5px] ring-black/40
                   pointer-events-none group-hover/sl:scale-[1.2] transition-transform duration-100"
        style={{ left: `calc(${value * 100}% - 6.5px)` }}
      />
      <WheelSlider
        min={0} max={1} step={0.01}
        value={value}
        onChange={onChange}
        className="absolute inset-x-0 opacity-0 h-4 w-full cursor-pointer"
      />
    </div>
  )
}

function SelectRow({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: { id: string; name: string }[]
  onChange: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-white/40 w-12 shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-7 rounded-lg bg-white/[0.08] px-2 text-[11px] text-white/85
                   border border-white/[0.1] cursor-pointer focus:outline-none
                   focus:border-[#86B735]/50"
      >
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  )
}

export function ComparePanel({
  models, selectedModel, orthophotos,
  overlayModel, compareBlend, orthoCompare,
  onOverlayModelChange, onCompareBlendChange, onOrthoCompareChange,
}: Props) {
  const [open, setOpen] = useState(false)

  const readyOrthophotos = orthophotos.filter((p) => p.status === 'ready')
  const isActive = overlayModel !== null || (orthoCompare?.beforeId && orthoCompare?.afterId)
  const overlayOptions = models.filter((m) => m.id !== selectedModel?.id)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-8 px-3 rounded-xl text-xs font-medium select-none',
          'bg-[#080c18]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
          isActive
            ? 'border-sky-400/50 text-sky-300 shadow-sky-400/10'
            : open
            ? 'border-[#86B735]/50 text-[#a3d44a] shadow-[#86B735]/10'
            : 'border-white/15 text-white/75 hover:text-white/95 hover:border-white/25',
        )}
      >
        <GitCompareArrows className="w-3.5 h-3.5" />
        <span>Compare</span>
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>

      {open && (
        <div className={cn(PANEL, 'absolute bottom-full mb-2 right-0 w-80 flex flex-col overflow-hidden')}>

          {/* ── Models ── */}
          <div className="px-4 py-3 border-b border-white/[0.08]">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-white/50">
              Models
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {/* Base — read-only display */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/40 w-12 shrink-0">Base</span>
                <div className="flex-1 h-7 rounded-lg bg-white/[0.04] px-2.5 flex items-center border border-white/[0.06]">
                  <span className="text-[11px] text-white/45 truncate">
                    {selectedModel?.name ?? 'No model selected'}
                  </span>
                </div>
              </div>

              {/* Overlay — model picker */}
              <SelectRow
                label="Overlay"
                value={overlayModel?.id ?? ''}
                options={overlayOptions}
                onChange={(id) => onOverlayModelChange(models.find((m) => m.id === id) ?? null)}
              />
            </div>

            {/* Model blend slider — only when overlay is set */}
            {overlayModel && (
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-white/35">Base</span>
                  <span className="text-[10px] font-mono text-[#a3d44a]">
                    {Math.round(compareBlend * 100)}% overlay
                  </span>
                  <span className="text-[10px] text-white/35">Overlay</span>
                </div>
                <BlendSlider value={compareBlend} onChange={onCompareBlendChange} />
              </div>
            )}
          </div>

          {/* ── Orthophotos ── */}
          {readyOrthophotos.length >= 2 && (
            <div className="px-4 py-3">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-white/50">
                Orthophotos
              </span>
              <div className="mt-2 flex flex-col gap-2">
                <SelectRow
                  label="Before"
                  value={orthoCompare?.beforeId ?? ''}
                  options={readyOrthophotos}
                  onChange={(id) => {
                    if (!id) { onOrthoCompareChange(null); return }
                    onOrthoCompareChange({
                      beforeId: id,
                      afterId: orthoCompare?.afterId ?? '',
                      blend: orthoCompare?.blend ?? 0.5,
                    })
                  }}
                />
                <SelectRow
                  label="After"
                  value={orthoCompare?.afterId ?? ''}
                  options={readyOrthophotos}
                  onChange={(id) => {
                    if (!id) { onOrthoCompareChange(null); return }
                    onOrthoCompareChange({
                      beforeId: orthoCompare?.beforeId ?? '',
                      afterId: id,
                      blend: orthoCompare?.blend ?? 0.5,
                    })
                  }}
                />
              </div>

              {/* Ortho blend slider — only when both sides are selected */}
              {orthoCompare?.beforeId && orthoCompare?.afterId && (
                <div className="mt-3 flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-white/35">Before</span>
                    <span className="text-[10px] font-mono text-[#a3d44a]">
                      {Math.round(orthoCompare.blend * 100)}% after
                    </span>
                    <span className="text-[10px] text-white/35">After</span>
                  </div>
                  <BlendSlider
                    value={orthoCompare.blend}
                    onChange={(v) => onOrthoCompareChange({ ...orthoCompare, blend: v })}
                  />
                </div>
              )}
            </div>
          )}

          {readyOrthophotos.length < 2 && readyOrthophotos.length > 0 && (
            <div className="px-4 pb-3 text-[11px] text-white/30 text-center">
              Upload a second orthophoto to compare
            </div>
          )}
        </div>
      )}
    </div>
  )
}
