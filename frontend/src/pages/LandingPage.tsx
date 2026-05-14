import { useNavigate } from 'react-router-dom'

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" dir="ltr">

      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border/50 backdrop-blur-sm sticky top-0 z-40 bg-background/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Quadspectat" className="h-10 sm:h-12 w-auto" />
        </div>
        <div className="flex items-center gap-3 sm:gap-6">
          <a href="#services" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
            Services
          </a>
          <a href="#about" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
            About
          </a>
          <a href="#contact" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">
            Contact
          </a>
          <button
            onClick={() => navigate('/app')}
            className="h-9 px-4 sm:px-5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            Open Viewer
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center px-4 sm:px-6 py-20 sm:py-32 overflow-hidden">
        {/* ── Animated drone background ── */}
        <div className="absolute inset-0 overflow-hidden">
          {/* Dark base gradient */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(134,183,53,0.07),transparent_70%)]" />

          {/* Topographic contour lines SVG */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.07]" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <style>{`
                @keyframes drift { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-18px)} }
                @keyframes droneFly {
                  0%   { transform: translate(0px, 0px) rotate(0deg); }
                  25%  { transform: translate(120px, -40px) rotate(5deg); }
                  50%  { transform: translate(240px, 10px) rotate(-3deg); }
                  75%  { transform: translate(120px, 50px) rotate(4deg); }
                  100% { transform: translate(0px, 0px) rotate(0deg); }
                }
                @keyframes droneB {
                  0%   { transform: translate(0px,0px) rotate(0deg); }
                  30%  { transform: translate(-80px, 60px) rotate(-6deg); }
                  60%  { transform: translate(40px, 120px) rotate(3deg); }
                  100% { transform: translate(0px,0px) rotate(0deg); }
                }
                @keyframes scanRing {
                  0%   { r: 10; opacity: 0.6; }
                  100% { r: 120; opacity: 0; }
                }
                @keyframes scanRing2 {
                  0%   { r: 10; opacity: 0.5; }
                  100% { r: 90; opacity: 0; }
                }
                @keyframes dashMove { to { stroke-dashoffset: -200; } }
              `}</style>
            </defs>

            {/* Contour rings — terrain-like ellipses */}
            {[200,170,140,110,80,50,20].map((r, i) => (
              <ellipse key={r} cx="50%" cy="38%" rx={r * 3.2} ry={r * 1.4}
                fill="none" stroke="#86B735" strokeWidth="1"
                style={{ animation: `drift ${6 + i * 0.7}s ease-in-out infinite`, animationDelay: `${i * 0.4}s`, transformOrigin: '50% 38%' }} />
            ))}
            {/* Second terrain cluster offset */}
            {[120,95,65,38].map((r, i) => (
              <ellipse key={'b' + r} cx="78%" cy="72%" rx={r * 2.4} ry={r * 1.1}
                fill="none" stroke="#86B735" strokeWidth="1" opacity="0.6"
                style={{ animation: `drift ${5 + i * 0.8}s ease-in-out infinite`, animationDelay: `${i * 0.5 + 1}s`, transformOrigin: '78% 72%' }} />
            ))}

            {/* Grid overlay */}
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#86B735" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" opacity="0.4" />

            {/* Dashed flight path A */}
            <path d="M 15% 80% Q 35% 20% 60% 45% T 90% 25%"
              fill="none" stroke="#86B735" strokeWidth="1.2" strokeDasharray="8 6"
              style={{ animation: 'dashMove 4s linear infinite' }} />
            {/* Dashed flight path B */}
            <path d="M 80% 85% Q 60% 55% 35% 70% T 10% 40%"
              fill="none" stroke="#86B735" strokeWidth="1" strokeDasharray="6 8" opacity="0.6"
              style={{ animation: 'dashMove 6s linear infinite reverse' }} />

            {/* Scan ping A */}
            <circle cx="60%" cy="45%" r="10" fill="none" stroke="#86B735" strokeWidth="1.5"
              style={{ animation: 'scanRing 3s ease-out infinite' }} />
            <circle cx="60%" cy="45%" r="10" fill="none" stroke="#86B735" strokeWidth="1"
              style={{ animation: 'scanRing 3s ease-out infinite', animationDelay: '1.5s' }} />
            {/* Scan ping B */}
            <circle cx="25%" cy="62%" r="10" fill="none" stroke="#86B735" strokeWidth="1.2"
              style={{ animation: 'scanRing2 4s ease-out infinite', animationDelay: '0.8s' }} />
          </svg>

          {/* Drone silhouette A — animated */}
          <div className="absolute" style={{ top: '22%', left: '62%', animation: 'droneFly 18s ease-in-out infinite' }}>
            <svg viewBox="0 0 80 80" className="w-14 h-14 opacity-[0.18]" fill="#86B735" xmlns="http://www.w3.org/2000/svg">
              {/* Body */}
              <rect x="32" y="32" width="16" height="16" rx="3"/>
              {/* Arms */}
              <rect x="8" y="38" width="24" height="4" rx="2"/>
              <rect x="48" y="38" width="24" height="4" rx="2"/>
              <rect x="38" y="8" width="4" height="24" rx="2"/>
              <rect x="38" y="48" width="4" height="24" rx="2"/>
              {/* Rotors */}
              <ellipse cx="12" cy="12" rx="11" ry="3.5" opacity="0.7"/>
              <ellipse cx="68" cy="12" rx="11" ry="3.5" opacity="0.7"/>
              <ellipse cx="12" cy="68" rx="11" ry="3.5" opacity="0.7"/>
              <ellipse cx="68" cy="68" rx="11" ry="3.5" opacity="0.7"/>
              {/* Motor dots */}
              <circle cx="12" cy="12" r="3"/>
              <circle cx="68" cy="12" r="3"/>
              <circle cx="12" cy="68" r="3"/>
              <circle cx="68" cy="68" r="3"/>
            </svg>
          </div>

          {/* Drone silhouette B — slower, different path */}
          <div className="absolute" style={{ top: '55%', left: '18%', animation: 'droneB 24s ease-in-out infinite', animationDelay: '4s' }}>
            <svg viewBox="0 0 80 80" className="w-10 h-10 opacity-[0.13]" fill="#86B735" xmlns="http://www.w3.org/2000/svg">
              <rect x="32" y="32" width="16" height="16" rx="3"/>
              <rect x="8" y="38" width="24" height="4" rx="2"/>
              <rect x="48" y="38" width="24" height="4" rx="2"/>
              <rect x="38" y="8" width="4" height="24" rx="2"/>
              <rect x="38" y="48" width="4" height="24" rx="2"/>
              <ellipse cx="12" cy="12" rx="11" ry="3.5" opacity="0.7"/>
              <ellipse cx="68" cy="12" rx="11" ry="3.5" opacity="0.7"/>
              <ellipse cx="12" cy="68" rx="11" ry="3.5" opacity="0.7"/>
              <ellipse cx="68" cy="68" rx="11" ry="3.5" opacity="0.7"/>
              <circle cx="12" cy="12" r="3"/>
              <circle cx="68" cy="12" r="3"/>
              <circle cx="12" cy="68" r="3"/>
              <circle cx="68" cy="68" r="3"/>
            </svg>
          </div>

          {/* Bottom fade to page bg */}
          <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-background to-transparent" />
        </div>
        {/* Radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(134,183,53,0.08),transparent)]" />

        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Aerial Intelligence Platform
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
            See Your World
            <br />
            <span style={{ color: 'var(--brand-green)' }}>From Above</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            Professional drone aerial photography and 3D photogrammetry services.
            From cinematic aerials to precise 3D models — we capture what ground-level cameras can't.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate('/app')}
              className="h-11 px-8 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30"
            >
              Launch 3D Viewer →
            </button>
            <a
              href="#services"
              className="h-11 px-8 rounded-lg text-sm font-medium border border-border hover:border-primary/50 hover:bg-accent transition-colors"
            >
              Our Services
            </a>
          </div>
        </div>

        {/* Stats row */}
        <div className="relative z-10 mt-20 flex flex-col sm:flex-row items-center justify-center gap-12 sm:gap-16">
          {[
            { number: '500+', label: 'Projects Delivered' },
            { number: '4K', label: 'Ultra-HD Imagery' },
            { number: '1 cm', label: 'Ground Resolution' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold" style={{ color: 'var(--brand-green)' }}>{stat.number}</div>
              <div className="text-xs text-muted-foreground mt-1 uppercase tracking-widest">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Services ────────────────────────────────────────────── */}
      <section id="services" className="px-4 sm:px-6 py-16 sm:py-24 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-3">What We Do</h2>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">
              End-to-end aerial intelligence — from flight planning to deliverable 3D assets.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                  </svg>
                ),
                title: 'Aerial Photography',
                description: 'Cinematic 4K video and high-resolution stills from any altitude. Perfect for real estate, construction, and events.',
              },
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                  </svg>
                ),
                title: '3D Photogrammetry',
                description: 'Accurate 3D models and textured meshes from drone imagery. Ideal for construction monitoring, archaeology, and GIS.',
              },
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                  </svg>
                ),
                title: 'Survey & Mapping',
                description: 'Precision topographic surveys, orthophotos, and digital elevation models with centimetre-level accuracy.',
              },
            ].map((service) => (
              <div
                key={service.title}
                className="group rounded-xl border border-border bg-card p-6 hover:border-primary/40 hover:bg-accent transition-all duration-200"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary group-hover:bg-primary/20 transition-colors">
                  {service.icon}
                </div>
                <h3 className="font-semibold mb-2">{service.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{service.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3D Viewer CTA ────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 py-16 sm:py-20 border-t border-border/50">
        <div className="max-w-3xl mx-auto rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_100%,rgba(134,183,53,0.1),transparent)]" />
          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-3">Interactive 3D Model Viewer</h2>
            <p className="text-muted-foreground text-sm mb-6 max-w-lg mx-auto">
              Explore your delivered 3D models directly in the browser. Measure distances,
              switch basemaps, and share links with your team — no software required.
            </p>
            <button
              onClick={() => navigate('/app')}
              className="h-11 px-8 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
            >
              Open the Viewer
            </button>
          </div>
        </div>
      </section>

      {/* ── About ───────────────────────────────────────────────── */}
      <section id="about" className="px-4 sm:px-6 py-16 sm:py-24 border-t border-border/50">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold mb-4">About Quadspectat</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              <strong className="text-foreground">Quadspectat</strong> — "נקודת מבט" — is an Israeli aerial photography and photogrammetry company,
              founded and led by <strong className="text-foreground">Eddie Tismenetsky</strong>.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              We specialise in high-resolution aerial imaging, 3D terrain reconstruction, and professional drone surveys across Israel.
              Our deliverables are used by architects, urban planners, engineers, and environmental consultants.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {[
              { label: 'Licensed Drone Operations', desc: 'CAAI-certified, fully insured flights' },
              { label: 'Precision Processing', desc: 'Agisoft Metashape & RealityCapture pipelines' },
              { label: 'Fast Turnaround', desc: 'Deliverables within 48–72 hours of flight' },
              { label: 'Data Security', desc: 'End-to-end encrypted delivery and storage' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3 p-4 rounded-lg border border-border bg-card">
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
      <section id="contact" className="px-4 sm:px-6 py-16 sm:py-24 border-t border-border/50">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3">Get in Touch</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Planning a project? We'll scope it, fly it, and deliver it.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {/* WhatsApp */}
            <a
              href="https://web.whatsapp.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="w-full sm:w-auto flex items-center justify-center gap-2.5 h-12 px-6 rounded-xl text-sm font-medium border border-border hover:border-[#25D366]/60 hover:bg-[#25D366]/10 transition-colors group"
            >
              <svg viewBox="0 0 32 32" className="w-5 h-5 fill-[#25D366]" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.003 2.667C8.639 2.667 2.667 8.64 2.667 16c0 2.347.638 4.639 1.847 6.64L2.667 29.333l6.88-1.813A13.277 13.277 0 0 0 16.003 29.333C23.36 29.333 29.333 23.36 29.333 16S23.36 2.667 16.003 2.667zm0 24.267a11.01 11.01 0 0 1-5.627-1.547l-.4-.24-4.08 1.08 1.093-4-.267-.413A10.96 10.96 0 0 1 5.003 16c0-6.067 4.933-11 11-11s11 4.933 11 11-4.933 11-11 11zm6.04-8.253c-.333-.167-1.96-.96-2.267-1.067-.306-.107-.52-.16-.747.16-.226.32-.866 1.067-1.066 1.28-.2.213-.4.24-.733.08-.333-.16-1.413-.52-2.693-1.653-.993-.893-1.667-1.987-1.867-2.32-.2-.333-.02-.507.147-.667.147-.147.333-.373.507-.56.173-.187.226-.32.333-.533.107-.213.053-.4-.027-.56-.08-.16-.747-1.787-1.027-2.44-.267-.64-.547-.547-.747-.56-.2-.013-.413-.013-.627-.013s-.573.08-.88.387c-.306.307-1.146 1.12-1.146 2.72s1.173 3.16 1.333 3.373c.16.213 2.28 3.547 5.547 4.827.773.32 1.373.507 1.84.653.773.24 1.48.2 2.04.12.613-.093 1.96-.8 2.24-1.573.28-.773.28-1.44.2-1.573-.08-.147-.307-.227-.64-.387z"/>
              </svg>
              <span className="text-foreground/80 group-hover:text-[#25D366] transition-colors">WhatsApp</span>
            </a>

            {/* Gmail */}
            <a
              href="https://mail.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Gmail"
              className="w-full sm:w-auto flex items-center justify-center gap-2.5 h-12 px-6 rounded-xl text-sm font-medium border border-border hover:border-[#EA4335]/60 hover:bg-[#EA4335]/10 transition-colors group"
            >
              <svg viewBox="0 0 32 32" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.667 8.667v14.666C2.667 24.8 3.867 26 5.333 26H8V15.04L16 20.8l8-5.76V26h2.667c1.466 0 2.666-1.2 2.666-2.667V8.667L16 17.333 2.667 8.667z" fill="#EA4335"/>
                <path d="M29.333 6H2.667L16 14.667 29.333 6z" fill="#FBBC05"/>
              </svg>
              <span className="text-foreground/80 group-hover:text-[#EA4335] transition-colors">Gmail</span>
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="px-6 py-8 border-t border-border/50 mt-auto">
        <div className="max-w-5xl mx-auto flex items-center justify-center gap-3">
          <img src="/logo.png" alt="Quadspectat" className="h-8 w-auto opacity-80" />
          <span className="text-xs text-muted-foreground">Quadspectat · נקודת מבט · צילום אווירי</span>
        </div>
      </footer>

    </div>
  )
}
