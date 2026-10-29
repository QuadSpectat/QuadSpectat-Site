import { useNavigate } from 'react-router-dom'
import { ContourField } from '@/components/ContourField'

/** The photography showroom. On the combined deployment it lives at "/"; set VITE_SITE_URL to override. */
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? '/'

const ICON = {
  camera: 'M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316ZM16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z',
  cube: 'm21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9',
  map: 'M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z',
  ruler: 'M3 17 17 3l4 4L7 21l-4-4Zm4-4 2 2m1-5 2 2m1-5 2 2',
  archive: 'M3.75 7.5h16.5M4.5 7.5v10.5A2.25 2.25 0 0 0 6.75 20.25h10.5A2.25 2.25 0 0 0 19.5 18V7.5M9 11.25h6M3.75 7.5l1.5-3h13.5l1.5 3',
  share: 'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z',
}

const SERVICES = [
  { icon: ICON.camera, title: 'Aerial Photography', description: 'Cinematic 4K video and high-resolution stills from any altitude. Perfect for real estate, construction, and events.' },
  { icon: ICON.cube, title: '3D Photogrammetry', description: 'Accurate 3D models and textured meshes from drone imagery. Ideal for construction monitoring, archaeology, and GIS.' },
  { icon: ICON.map, title: 'Survey & Mapping', description: 'Precision topographic surveys, orthophotos, and digital elevation models with centimetre-level accuracy.' },
  { icon: ICON.archive, title: 'Project Archive', description: 'Every model and orthophoto stays organised by project and date, so a client can come back to it later.' },
  { icon: ICON.ruler, title: 'Measure & Compare', description: 'Distance, area and height straight from the model, plus a before / after comparison of the same site.' },
  { icon: ICON.share, title: 'Share by Link', description: 'Clients open the model or orthophoto from a single link. No account and no software.' },
]

const VIEWER_FEATURES = [
  ['Measure', 'Distance, area and height directly on the model.'],
  ['Compare', 'A before / after slider between two states of one site.'],
  ['Geopoints', 'Mark points with coordinates, add notes, share them.'],
  ['Layers & basemaps', 'Show or hide models and orthophotos, switch the basemap.'],
  ['Visual controls', 'Opacity, brightness and contrast for orthophotos.'],
  ['Shareable links', 'A public link for each model or orthophoto.'],
]

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" dir="ltr">

      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className="flex items-center justify-between gap-3 px-4 sm:px-8 py-3 border-b border-border/60 sticky top-0 z-40 bg-background/85 backdrop-blur-md">
        <a href="#top" className="flex items-center gap-3 shrink-0">
          <img src="/mark-on-dark.svg" alt="QuadSpectat" className="h-11 w-11" />
          <span className="hidden sm:block font-display font-medium leading-tight">QuadSpectat<br /><span className="text-xs text-muted-foreground font-sans">Drone Studio</span></span>
        </a>
        <div className="flex items-center gap-3 sm:gap-6">
          {[['#services', 'Services'], ['#viewer', 'Viewer'], ['#about', 'About'], ['#contact', 'Contact']].map(([href, label]) => (
            <a key={href} href={href} className="hidden md:block text-sm text-muted-foreground hover:text-foreground transition-colors">{label}</a>
          ))}
          <a href={SITE_URL} className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">Photography ↗</a>
          <button
            onClick={() => navigate('/app')}
            className="h-9 px-4 sm:px-5 rounded text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            Open Viewer
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section id="top" className="relative isolate overflow-hidden border-b border-border/60">
        <ContourField className="absolute inset-0 -z-20 h-full w-full" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_80%_at_70%_20%,transparent,hsl(var(--background)/0.75))]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-20 sm:py-32">
          <p className="font-mono text-xs tracking-[0.18em] uppercase text-primary mb-5">Aerial mapping · 3D models · Orthophotos</p>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-medium tracking-tight leading-[1.02] max-w-3xl">
            See Your World
            <br />
            <span className="text-primary">From Above</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mt-6 mb-9 leading-relaxed">
            Professional drone aerial photography and 3D photogrammetry services.
            From cinematic aerials to precise 3D models, we capture what ground-level cameras can't.
          </p>
          <div className="flex flex-col sm:flex-row items-start gap-3">
            <button
              onClick={() => navigate('/app')}
              className="h-11 px-8 rounded text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Launch the 3D Viewer →
            </button>
            <a href="#services" className="h-11 px-8 rounded text-sm font-medium border border-foreground/40 hover:border-primary hover:text-primary transition-colors inline-flex items-center">
              Our Services
            </a>
          </div>

          <div className="mt-16 grid grid-cols-3 gap-6 max-w-xl">
            {[
              { number: '500+', label: 'Projects Delivered' },
              { number: '4K', label: 'Ultra-HD Imagery' },
              { number: '1 cm', label: 'Ground Resolution' },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="font-display text-2xl sm:text-3xl font-medium text-primary">{stat.number}</div>
                <div className="font-mono text-[10px] sm:text-xs text-muted-foreground mt-1 uppercase tracking-widest">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
        <span className="absolute bottom-2 left-4 sm:left-8 font-mono text-[10px] tracking-widest text-primary/70">N 32°30′ · E 35°00′ · GRID 14 · INTERVAL 20 m</span>
      </section>

      {/* ── Formats strip ───────────────────────────────────────── */}
      <div className="border-b border-border/60 bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap justify-between gap-x-8 gap-y-2 font-mono text-[11px] tracking-[0.14em] uppercase text-primary">
          {['3D Tiles', 'COG GeoTIFF', 'Orthophotos', 'GLB models', 'Share by link'].map((f) => <span key={f}>{f}</span>)}
        </div>
      </div>

      {/* ── Services ────────────────────────────────────────────── */}
      <section id="services" className="px-4 sm:px-8 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <p className="font-mono text-xs tracking-[0.18em] uppercase text-primary mb-2">Services</p>
          <h2 className="text-3xl sm:text-4xl font-medium mb-3">What We Do</h2>
          <p className="text-muted-foreground max-w-xl mb-12">
            End-to-end aerial intelligence, from flight planning to deliverable 3D assets.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {SERVICES.map((s) => (
              <div key={s.title} className="group rounded border border-border bg-card/80 p-6 hover:border-primary/50 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-primary mb-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                </svg>
                <h3 className="font-medium text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3D Viewer ───────────────────────────────────────────── */}
      <section id="viewer" className="px-4 sm:px-8 py-16 sm:py-24 border-y border-border/60 bg-card/50">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="font-mono text-xs tracking-[0.18em] uppercase text-primary mb-2">3D Viewer</p>
            <h2 className="text-3xl sm:text-4xl font-medium mb-4">Interactive 3D Model Viewer</h2>
            <p className="text-muted-foreground leading-relaxed mb-8 max-w-lg">
              Explore delivered 3D models directly in the browser. Measure distances,
              switch basemaps, and share links with your team. No software required.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => navigate('/app')}
                className="h-11 px-8 rounded text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Open the live demo
              </button>
              <span className="text-xs text-muted-foreground self-center">The public demo is a 3D model of Haifa.</span>
            </div>
          </div>
          <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
            {VIEWER_FEATURES.map(([title, text]) => (
              <li key={title} className="border-l-2 border-primary pl-4">
                <div className="font-display font-medium">{title}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{text}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Photography cross-link ──────────────────────────────── */}
      <section className="px-4 sm:px-8 py-14">
        <div className="max-w-6xl mx-auto rounded border border-border bg-card/70 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-medium">Looking for prints and licences?</h2>
            <p className="text-sm text-muted-foreground mt-1">Landscape, sea, architecture and city photography, as wall prints and digital licences.</p>
          </div>
          <a href={SITE_URL} className="h-11 px-7 rounded text-sm font-semibold border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors inline-flex items-center justify-center whitespace-nowrap">
            Visit the photography showroom ↗
          </a>
        </div>
      </section>

      {/* ── About ───────────────────────────────────────────────── */}
      <section id="about" className="px-4 sm:px-8 py-16 sm:py-24 border-t border-border/60">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-medium mb-4">About Quadspectat</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              <strong className="text-foreground">Quadspectat</strong> — "נקודת מבט" — is an Israeli aerial photography and photogrammetry company,
              founded and led by <strong className="text-foreground">Eddie Tismenetsky</strong>.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              We specialise in high-resolution aerial imaging, 3D terrain reconstruction, and professional drone surveys across Israel.
              Our deliverables are used by architects, urban planners, engineers, and environmental consultants.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {[
              { label: 'Licensed Drone Operations', desc: 'CAAI-certified, fully insured flights' },
              { label: 'Precision Processing', desc: 'Agisoft Metashape & RealityCapture pipelines' },
              { label: 'Fast Turnaround', desc: 'Deliverables within 48–72 hours of flight' },
              { label: 'Data Security', desc: 'End-to-end encrypted delivery and storage' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3 p-4 rounded border border-border bg-card/80">
                <span className="mt-0.5 text-primary">✓</span>
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact ─────────────────────────────────────────────── */}
      <section id="contact" className="px-4 sm:px-8 py-16 sm:py-24 border-t border-border/60">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl font-medium mb-3">Get in Touch</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Planning a project? We'll scope it, fly it, and deliver it.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {/* WhatsApp */}
            <a
              href="https://wa.me/972544642180"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="w-full sm:w-auto flex items-center justify-center gap-2.5 h-12 px-6 rounded text-sm font-medium border border-border hover:border-[#25D366]/60 hover:bg-[#25D366]/10 transition-colors group"
            >
              <svg viewBox="0 0 32 32" className="w-5 h-5 fill-[#25D366]" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.003 2.667C8.639 2.667 2.667 8.64 2.667 16c0 2.347.638 4.639 1.847 6.64L2.667 29.333l6.88-1.813A13.277 13.277 0 0 0 16.003 29.333C23.36 29.333 29.333 23.36 29.333 16S23.36 2.667 16.003 2.667zm0 24.267a11.01 11.01 0 0 1-5.627-1.547l-.4-.24-4.08 1.08 1.093-4-.267-.413A10.96 10.96 0 0 1 5.003 16c0-6.067 4.933-11 11-11s11 4.933 11 11-4.933 11-11 11zm6.04-8.253c-.333-.167-1.96-.96-2.267-1.067-.306-.107-.52-.16-.747.16-.226.32-.866 1.067-1.066 1.28-.2.213-.4.24-.733.08-.333-.16-1.413-.52-2.693-1.653-.993-.893-1.667-1.987-1.867-2.32-.2-.333-.02-.507.147-.667.147-.147.333-.373.507-.56.173-.187.226-.32.333-.533.107-.213.053-.4-.027-.56-.08-.16-.747-1.787-1.027-2.44-.267-.64-.547-.547-.747-.56-.2-.013-.413-.013-.627-.013s-.573.08-.88.387c-.306.307-1.146 1.12-1.146 2.72s1.173 3.16 1.333 3.373c.16.213 2.28 3.547 5.547 4.827.773.32 1.373.507 1.84.653.773.24 1.48.2 2.04.12.613-.093 1.96-.8 2.24-1.573.28-.773.28-1.44.2-1.573-.08-.147-.307-.227-.64-.387z"/>
              </svg>
              <span className="text-foreground/80 group-hover:text-[#25D366] transition-colors">+972 54-464-2180</span>
            </a>

            {/* Gmail */}
            <a
              href="mailto:seddiet@gmail.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Email"
              className="w-full sm:w-auto flex items-center justify-center gap-2.5 h-12 px-6 rounded text-sm font-medium border border-border hover:border-[#EA4335]/60 hover:bg-[#EA4335]/10 transition-colors group"
            >
              <svg viewBox="0 0 32 32" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.667 8.667v14.666C2.667 24.8 3.867 26 5.333 26H8V15.04L16 20.8l8-5.76V26h2.667c1.466 0 2.666-1.2 2.666-2.667V8.667L16 17.333 2.667 8.667z" fill="#EA4335"/>
                <path d="M29.333 6H2.667L16 14.667 29.333 6z" fill="#FBBC05"/>
              </svg>
              <span className="text-foreground/80 group-hover:text-[#EA4335] transition-colors">seddiet@gmail.com</span>
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="px-6 py-8 border-t border-border/60 mt-auto">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-3">
          <img src="/mark-on-dark.svg" alt="QuadSpectat" className="h-9 w-9 opacity-90" />
          <span className="text-xs text-muted-foreground">Quadspectat · נקודת מבט · מכל זווית</span>
        </div>
      </footer>

    </div>
  )
}
