import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { listViews, createView, deleteView } from '@/lib/api'
import type { SavedView, ViewApi } from '@/lib/views'

interface Props {
  modelId: string | null
  viewApiRef: React.MutableRefObject<ViewApi | null>
  shareToken?: string
  editable: boolean
}

function errText(e: unknown, fallback: string): string {
  const msg = String((e as Error)?.message ?? e)
  return /\b401\b/.test(msg) ? 'Sign in on the admin page first' : fallback
}

export function ViewsPanel({ modelId, viewApiRef, shareToken, editable }: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setViews([])
    setError(null)
    if (!modelId) return
    let cancelled = false
    listViews(modelId, shareToken)
      .then((v) => { if (!cancelled) setViews(v) })
      .catch(() => { if (!cancelled) setError('Could not load views') })
    return () => { cancelled = true }
  }, [modelId, shareToken])

  if (!modelId) return null
  if (!editable && views.length === 0) return null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy || !modelId) return
    const camera = viewApiRef.current?.capture()
    if (!camera) { setError('Camera is not ready yet'); return }
    setBusy(true)
    setError(null)
    try {
      const v = await createView(modelId, trimmed, camera)
      setViews((prev) => [...prev, v])
      setName('')
    } catch (err) {
      setError(errText(err, 'Could not save the view'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(v: SavedView) {
    if (!window.confirm(`Delete view "${v.name}"?`)) return
    setError(null)
    try {
      await deleteView(v.id)
      setViews((prev) => prev.filter((x) => x.id !== v.id))
    } catch (err) {
      setError(errText(err, 'Could not delete the view'))
    }
  }

  return (
    <section
      aria-label="Views"
      className="rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 p-3 flex flex-col gap-2"
    >
      <h2 className="text-[10px] font-semibold tracking-widest uppercase text-white/50">Views</h2>

      {views.length === 0 && editable && (
        <p className="text-xs text-white/60">
          Fly to a good angle, name it, and save it. Clients see these as buttons.
        </p>
      )}

      {views.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {views.map((v) => (
            <li key={v.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => viewApiRef.current?.flyTo(v.camera)}
                className="flex-1 min-w-0 min-h-11 px-3 rounded-xl border border-white/10 bg-white/5 text-left text-sm text-white/80
                           hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9ACD3C] transition-colors"
              >
                <span className="block truncate">{v.name}</span>
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => void handleDelete(v)}
                  aria-label={`Delete view ${v.name}`}
                  title="Delete view"
                  className="shrink-0 w-11 min-h-11 grid place-items-center rounded-xl text-white/50 hover:text-red-400 hover:bg-white/10
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9ACD3C] transition-colors"
                >
                  <X size={16} strokeWidth={2} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-1.5">
          <input
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this view"
            aria-label="View name"
            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white/80 placeholder:text-white/40
                       focus:outline-none focus:border-[#9ACD3C] transition-colors"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="h-11 rounded-xl text-sm font-semibold bg-[#9ACD3C] text-[#0b100d] hover:brightness-110
                       disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {busy ? 'Saving…' : 'Save current view'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-400">{error}</p>
      )}
    </section>
  )
}
