import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getClientPage } from '@/lib/api'
import type { ClientPageData } from '@/lib/api'

const WHATSAPP = 'https://wa.me/972544642180'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** A client's private page: lists only the models and orthophotos assigned to them. No login; the link is the key. */
export function ClientPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ClientPageData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'expired' | 'missing'>('loading')

  useEffect(() => {
    if (!token) { setState('missing'); return }
    getClientPage(token)
      .then((d) => { setData(d); setState('ok') })
      .catch((e: Error) => setState(String(e.message).startsWith('410') ? 'expired' : 'missing'))
  }, [token])

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-svh bg-background text-foreground flex flex-col">
      <header className="flex items-center gap-3 px-4 sm:px-8 border-b border-border shrink-0" style={{ height: '56px' }}>
        <img src="/logo.svg" alt="QuadSpectat" className="h-9 w-auto shrink-0" />
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <span className="text-sm font-semibold tracking-tight truncate">Your projects</span>
      </header>
      <main className="flex-1 px-4 sm:px-8 py-10 sm:py-14">
        <div className="max-w-4xl mx-auto">{children}</div>
      </main>
      <footer className="px-4 sm:px-8 py-6 border-t border-border text-xs text-muted-foreground text-center">
        QuadSpectat · נקודת מבט · This page is private. Please do not share the link.
      </footer>
    </div>
  )

  if (state === 'loading') return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>

  if (state !== 'ok' || !data) {
    return (
      <Shell>
        <div className="max-w-md">
          <h1 className="text-xl font-semibold mb-2">{state === 'expired' ? 'This page has expired' : 'We could not find this page'}</h1>
          <p className="text-sm text-muted-foreground mb-5">
            {state === 'expired'
              ? 'Client pages are valid for one year. Contact us and we will renew it for you.'
              : 'The link may be incomplete or has been removed. Please check it, or contact us.'}
          </p>
          <a href={WHATSAPP} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-10 px-5 items-center rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Contact QuadSpectat on WhatsApp
          </a>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{data.name}</h1>
      {data.note && <p className="text-muted-foreground mt-2 max-w-2xl">{data.note}</p>}
      <p className="text-xs text-muted-foreground mt-2">This page is valid until {fmtDate(data.expires_at)}.</p>

      {data.assets.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">Nothing has been added to this page yet.</p>
      ) : (
        <ul className="mt-8 grid sm:grid-cols-2 gap-4">
          {data.assets.map((a) => (
            <li key={a.share_token} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-primary/40 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded bg-primary/15 text-primary">
                  {a.kind === 'orthophoto' ? 'Orthophoto' : '3D model'}
                </span>
              </div>
              <h2 className="font-semibold leading-snug">{a.name}</h2>
              {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
              <Link to={`/v/${a.share_token}?from=${encodeURIComponent(`/c/${token}`)}`}
                className="mt-auto inline-flex h-9 px-4 w-fit items-center rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}
