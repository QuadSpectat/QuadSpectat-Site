import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getClientPage, isServerProblem } from '@/lib/api'
import { LogoMark } from '@/components/LogoMark'
import type { ClientPageData } from '@/lib/api'

const WHATSAPP = 'https://wa.me/972544642180'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** A client's private page: lists only the models and orthophotos assigned to them. No login; the link is the key. */
export function ClientPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ClientPageData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'expired' | 'missing' | 'unavailable'>('loading')

  useEffect(() => {
    if (!token) { setState('missing'); return }
    getClientPage(token)
      .then((d) => { setData(d); setState('ok') })
      .catch((e: Error) => setState(String(e.message).startsWith('410') ? 'expired' : isServerProblem(String(e.message)) ? 'unavailable' : 'missing'))
  }, [token])

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="skin-light min-h-svh bg-background text-foreground flex flex-col">
      <header className="flex items-center gap-3 px-4 sm:px-8 shrink-0" style={{ height: '72px' }}>
        <LogoMark size={40} filled className="shrink-0" />
        <div className="leading-tight min-w-0">
          <div className="font-bold tracking-tight">QuadSpectat</div>
          <div className="text-xs text-muted-foreground">Every Angle · Drone mapping</div>
        </div>
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
          {state === 'unavailable' ? (
            <>
              <h1 className="text-xl font-semibold mb-2" dir="rtl">השרת אינו זמין כרגע</h1>
              <h1 className="text-xl font-semibold mb-2">The server is unavailable right now</h1>
              <p className="text-sm text-muted-foreground mb-1" dir="rtl">הקישור תקין. נסו שוב בעוד מספר דקות, ואם זה נמשך צרו קשר.</p>
              <p className="text-sm text-muted-foreground mb-5">The link is fine. Please try again in a few minutes, and contact us if it continues.</p>
              <button type="button" onClick={() => window.location.reload()}
                className="mr-3 mb-3 inline-flex h-10 px-5 items-center rounded-lg text-sm font-semibold border border-border hover:bg-muted transition-colors">
                Try again / נסו שוב
              </button>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold mb-2">{state === 'expired' ? 'This page has expired' : 'We could not find this page'}</h1>
              <p className="text-sm text-muted-foreground mb-5">
                {state === 'expired'
                  ? 'Client pages are valid for one year. Contact us and we will renew it for you.'
                  : 'The link may be incomplete or has been removed. Please check it, or contact us.'}
              </p>
            </>
          )}
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
      <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">Prepared for</p>
      <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mt-1">{data.name}</h1>
      {data.note && <p className="text-muted-foreground mt-3 max-w-2xl text-base">{data.note}</p>}
      <p className="inline-block mt-4 text-xs px-3 py-1.5 rounded-full showcase-card text-muted-foreground">Valid until <strong className="text-foreground font-semibold">{fmtDate(data.expires_at)}</strong></p>

      {data.assets.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">Nothing has been added to this page yet.</p>
      ) : (
        <ul className="mt-8 grid sm:grid-cols-2 gap-4">
          {data.assets.map((a) => (
            <li key={a.share_token} className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-3 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded bg-primary/15 text-primary">
                  {a.kind === 'orthophoto' ? 'Orthophoto' : '3D model'}
                </span>
              </div>
              <h2 className="font-semibold leading-snug">{a.name}</h2>
              {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
              <Link to={`/v/${a.share_token}?from=${encodeURIComponent(`/c/${token}`)}&client=${encodeURIComponent(data.name)}`}
                className="mt-auto inline-flex h-11 px-5 w-fit items-center rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:brightness-105 transition">
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}
