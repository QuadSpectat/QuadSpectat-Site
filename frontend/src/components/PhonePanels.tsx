import { Ruler, Eye, SlidersHorizontal, Layers } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import type { SheetTab } from '@/components/BottomSheet'
import { MeasureToolbar } from '@/components/MeasureToolbar'
import { VisualPanelBody } from '@/components/VisualControls'
import { ViewsPanel } from '@/components/ViewsPanel'
import type { ViewApi } from '@/lib/views'
import type { VisualSettings } from '@/lib/visualControls'

type MeasureProps = Omit<React.ComponentProps<typeof MeasureToolbar>, 'part' | 'placement' | 'onUndo' | 'onFinish' | 'onResetCamera'>

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
  return <BottomSheet tabs={tabs} label="Viewer panels" />
}
