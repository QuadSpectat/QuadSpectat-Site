import { Ruler, Eye, SlidersHorizontal, Layers, Glasses } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import type { SheetTab } from '@/components/BottomSheet'
import { MeasureToolbar } from '@/components/MeasureToolbar'
import { VisualPanelBody } from '@/components/VisualControls'
import { ViewsPanel } from '@/components/ViewsPanel'
import { StereoPanelBody } from '@/components/StereoControls'
import { T, bi, setStereo, useStereoState } from '@/lib/anaglyph'
import type { ViewApi } from '@/lib/views'
import type { VisualSettings } from '@/lib/visualControls'

type MeasureProps = Omit<React.ComponentProps<typeof MeasureToolbar>, 'part' | 'placement' | 'onUndo' | 'onRedo' | 'onFinish' | 'onResetCamera'>

interface Props {
  measure: MeasureProps
  visual: { settings: VisualSettings; onChange: (s: VisualSettings) => void; onSnapToGround?: () => void; crsLabel?: string }
  /** Views tab only when a model is open */
  views?: { modelId: string | null; viewApiRef: React.MutableRefObject<ViewApi | null>; shareToken?: string; editable: boolean }
  /** Layers tab (the same body as the desktop popover); omitted when the model has no layers a visitor may see */
  layers?: { count: number; content: React.ReactNode }
}

/** The Visual / Views / Measurements panels as one bottom sheet (phones). Desktop keeps its floating panels. */
export function PhonePanels({ measure, visual, views, layers }: Props) {
  const stereo = useStereoState()
  const short = measure.result ? measure.result.replace(/^[^0-9-]*/, '').slice(0, 14) : undefined
  const tabs: SheetTab[] = [
    {
      id: 'measure', label: 'Measure', icon: <Ruler size={14} strokeWidth={1.9} />, badge: short,
      content: <MeasureToolbar {...measure} part="panels" />,
    },
  ]
  if (views && views.modelId) {
    tabs.push({
      id: 'views', label: 'Views', icon: <Eye size={14} strokeWidth={1.9} />,
      content: (
        <div className="flex flex-col gap-2 empty:before:content-['No_saved_views_for_this_model_yet.'] empty:before:text-xs empty:before:text-white/60">
          <ViewsPanel {...views} />
        </div>
      ),
    })
  }
  if (layers) {
    tabs.push({
      id: 'layers', label: 'Layers', icon: <Layers size={14} strokeWidth={1.9} />,
      content: layers.content,
    })
  }
  tabs.push({
    id: 'visual', label: 'Visual', icon: <SlidersHorizontal size={14} strokeWidth={1.9} />,
    content: <div className="flex flex-col gap-4"><VisualPanelBody {...visual} /></div>,
  })
  tabs.push({
    id: 'stereo', label: '3D', icon: <Glasses size={14} strokeWidth={1.9} />, badge: stereo.on && !stereo.blocked ? (stereo.paused ? '||' : 'ON') : undefined,
    content: <div className="flex flex-col gap-4"><StereoPanelBody /></div>,
  })
  return (
    <>
      <div className="qs-chrome contents"><BottomSheet tabs={tabs} label="Viewer panels" /></div>
      {stereo.hideMenus && (
        <button
          type="button" onClick={() => setStereo({ hideMenus: false })} aria-label={bi('showMenus')}
          className="qs-keep fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] right-3 z-30 h-11 px-4 rounded-xl text-xs font-medium border border-white/20 bg-[#090d0b]/70 text-white/80 backdrop-blur-md opacity-60 active:opacity-100"
        ><bdi>{T.showMenus.he}</bdi> / <bdi>{T.showMenus.en}</bdi></button>
      )}
    </>
  )
}
