import { RefreshCw } from 'lucide-react'

type Kind = 'lost' | 'repeated' | 'start'

const COPY: Record<Kind, { title: string; body: string; button: string }> = {
  lost: {
    title: 'The 3D view was paused by your phone.',
    body: 'Tap to reload. It will restart in Light mode so it uses less memory.',
    button: 'Tap to reload',
  },
  repeated: {
    title: 'Your phone is low on memory for this 3D view.',
    body: 'Close other tabs and apps, then reload. Light mode is on to keep the view as small as possible.',
    button: 'Reload',
  },
  start: {
    title: 'The 3D view could not start.',
    body: 'Your device may be low on memory. Close other tabs and apps, then try again.',
    button: 'Try again',
  },
}

/** Full-view card shown when the WebGL context is lost or could not be created. One big button, no jargon. */
export function GpuNoticeCard({ kind, onReload }: { kind: Kind; onReload: () => void }) {
  const c = COPY[kind]
  return (
    <div role="alert" className="absolute inset-0 z-40 grid place-items-center bg-[#0d110f]/85 backdrop-blur-sm p-4">
      <div className="w-full max-w-xs rounded-2xl border border-white/[0.15] bg-[#0b100d] shadow-2xl shadow-black/80 p-5 text-center text-white">
        <p className="text-[15px] font-semibold leading-snug">{c.title}</p>
        <p className="mt-2 text-xs text-white/70 leading-snug">{c.body}</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-4 w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[#9ACD3C] text-[#17220a] text-sm font-bold active:brightness-90"
        >
          <RefreshCw size={16} strokeWidth={2.2} />{c.button}
        </button>
      </div>
    </div>
  )
}
