import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Copy, Trash2, RefreshCw, X, ExternalLink, Users, Loader2 } from 'lucide-react'
import {
  listClientPages, createClientPage, renewClientPage, deleteClientPage, addClientAsset, removeClientAsset,
} from '@/lib/api'
import type { ClientPageAdmin, Model, Orthophoto } from '@/lib/api'

type Toast = (type: 'success' | 'error' | 'info', message: string) => void

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
const pageUrl = (p: ClientPageAdmin) => `${window.location.origin}${p.path}`

type Pick = { kind: 'model' | 'orthophoto'; id: string; name: string; group: string }

export function ClientPagesTab({ models, orthophotos, toast }: { models: Model[]; orthophotos: Orthophoto[]; toast: Toast }) {
  const [pages, setPages] = useState<ClientPageAdmin[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const everything: Pick[] = useMemo(() => [
    ...models.map((m) => ({ kind: 'model' as const, id: m.id, name: m.name, group: m.asset_name || 'No project name' })),
    ...orthophotos.map((o) => ({ kind: 'orthophoto' as const, id: o.id, name: o.name, group: o.asset_name || 'No project name' })),
  ], [models, orthophotos])
  const groups = useMemo(() => {
    const g = new Map<string, Pick[]>()
    for (const p of everything) g.set(p.group, [...(g.get(p.group) ?? []), p])
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [everything])

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setPages(await listClientPages()) } catch (e) { toast('error', `Could not load client pages: ${(e as Error).message}`) } finally { setLoading(false) }
  }, [toast])
  useEffect(() => { void refresh() }, [refresh])

  const key = (p: Pick) => `${p.kind}:${p.id}`
  const toggle = (p: Pick) => setPicked((s) => { const n = new Set(s); n.has(key(p)) ? n.delete(key(p)) : n.add(key(p)); return n })

  async function create() {
    if (!name.trim()) { toast('error', 'Give the client page a name first'); return }
    setBusy('create')
    try {
      const assets = everything.filter((p) => picked.has(key(p))).map((p) => ({ kind: p.kind, id: p.id }))
      const page = await createClientPage({ name: name.trim(), note: note.trim() || undefined, assets })
      setPages((ps) => [page, ...ps]); setName(''); setNote(''); setPicked(new Set())
      toast('success', `Created "${page.name}". Copy its link below.`)
    } catch (e) { toast('error', (e as Error).message) } finally { setBusy(null) }
  }

  const replace = (p: ClientPageAdmin) => setPages((ps) => ps.map((x) => (x.token === p.token ? p : x)))

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id)
    try { await fn() } catch (e) { toast('error', (e as Error).message) } finally { setBusy(null) }
  }

  const copy = (p: ClientPageAdmin) =>
    void navigator.clipboard.writeText(pageUrl(p)).then(() => toast('success', 'Link copied'), () => toast('error', 'Copy failed: select the link and copy it by hand'))

  const card = 'rounded-xl border border-white/10 bg-white/[0.03] p-4'
  const input = 'h-9 rounded-lg bg-white/[0.06] border border-white/10 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30'
  const btn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 text-xs text-white/70 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40'

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-white/50 max-w-3xl">
        One private link per client. It shows only the models and orthophotos you assign here, needs no login, and is valid for one year.
        Share the link with the client; renew it from this page when the year is up.
      </p>

      {/* New page */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Plus size={14} /> New client page</h2>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <input className={input} placeholder="Client name (e.g. Kfar Etzion Council)" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <input className={input} placeholder="Short note shown to the client (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
          {groups.length === 0 && <p className="p-3 text-xs text-white/40">No models or orthophotos uploaded yet.</p>}
          {groups.map(([g, items]) => (
            <div key={g} className="p-3">
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1.5">{g}</div>
              <div className="flex flex-col gap-1">
                {items.map((p) => (
                  <label key={key(p)} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                    <input type="checkbox" checked={picked.has(key(p))} onChange={() => toggle(p)} />
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/50">{p.kind === 'orthophoto' ? 'ortho' : 'model'}</span>
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors disabled:opacity-40" onClick={() => void create()} disabled={busy === 'create'}>
            {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />} Create client page
          </button>
          <span className="text-xs text-white/40">{picked.size} selected</span>
        </div>
      </div>

      {/* Existing pages */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Client pages ({pages.length})</h2>
        <button className={btn} onClick={() => void refresh()} disabled={loading}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
      {pages.length === 0 && !loading && <p className="text-sm text-white/40">No client pages yet.</p>}
      {pages.map((p) => {
        const left = daysLeft(p.expires_at)
        const inPage = new Set(p.assets.map((a) => `${a.kind}:${a.id}`))
        const addable = everything.filter((e) => !inPage.has(key(e)))
        return (
          <div key={p.token} className={card}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-white">{p.name}</h3>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${p.expired ? 'bg-red-500/20 text-red-300' : left <= 30 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                    {p.expired ? 'Expired' : `${left} days left`}
                  </span>
                </div>
                {p.note && <p className="text-xs text-white/50 mt-0.5">{p.note}</p>}
                <p className="text-xs text-white/40 mt-1">Valid until {fmt(p.expires_at)}</p>
                <input readOnly value={pageUrl(p)} onFocus={(e) => e.currentTarget.select()} className={`${input} w-full mt-2 text-xs font-mono`} aria-label="Client page link" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={() => copy(p)}><Copy size={12} /> Copy link</button>
                <a className={btn} href={p.path} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Preview</a>
                <button className={btn} disabled={busy === p.token} onClick={() => void act(p.token, async () => { replace(await renewClientPage(p.token)); toast('success', 'Renewed for another year') })}><RefreshCw size={12} /> Renew 1 year</button>
                <button className={`${btn} hover:!text-red-300 hover:!border-red-400/40`} disabled={busy === p.token}
                  onClick={() => { if (window.confirm(`Delete "${p.name}"? Its link and every asset link on it stop working immediately. The models themselves are not deleted.`)) void act(p.token, async () => { await deleteClientPage(p.token); setPages((ps) => ps.filter((x) => x.token !== p.token)); toast('success', 'Client page deleted') }) }}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {p.assets.length === 0 && <li className="text-xs text-white/40">No assets yet.</li>}
              {p.assets.map((a) => (
                <li key={a.share_token} className="inline-flex items-center gap-1.5 text-xs text-white/80 bg-white/[0.06] border border-white/10 rounded-lg pl-2.5 pr-1 py-1">
                  <span className="text-[10px] uppercase tracking-wider text-white/40">{a.kind === 'orthophoto' ? 'ortho' : 'model'}</span> {a.name}
                  <button aria-label={`Remove ${a.name}`} title="Remove from this page" className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-red-300"
                    disabled={busy === p.token} onClick={() => void act(p.token, async () => { replace(await removeClientAsset(p.token, a.share_token)); toast('info', `Removed "${a.name}"`) })}><X size={11} /></button>
                </li>
              ))}
            </ul>
            {addable.length > 0 && (
              <select className={`${input} mt-3 text-xs`} value="" aria-label="Add an asset to this page"
                onChange={(e) => { const v = e.target.value; if (!v) return; const [kind, id] = v.split(':'); void act(p.token, async () => { replace(await addClientAsset(p.token, kind as 'model' | 'orthophoto', id)); toast('success', 'Added') }) }}>
                <option value="">+ Add a model or orthophoto…</option>
                {addable.map((e) => <option key={key(e)} value={key(e)}>{e.group} / {e.name} ({e.kind === 'orthophoto' ? 'ortho' : 'model'})</option>)}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}
