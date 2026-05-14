import { useState, useEffect } from 'react'
import { createShareLink, listShareLinks, deleteShareLink } from '@/lib/api'
import type { ShareLink } from '@/lib/api'

interface Props {
  modelId: string
  modelName: string
  onClose: () => void
}

export function ShareDialog({ modelId, modelName, onClose }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const origin = window.location.origin

  useEffect(() => {
    listShareLinks(modelId)
      .then(setLinks)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [modelId])

  async function handleCreate() {
    setCreating(true)
    try {
      const { token } = await createShareLink(modelId, label.trim() || undefined)
      const newLink: ShareLink = { token, label: label.trim() || null, created_at: new Date().toISOString() }
      setLinks((prev) => [newLink, ...prev])
      setLabel('')
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(token: string) {
    await deleteShareLink(token)
    setLinks((prev) => prev.filter((l) => l.token !== token))
  }

  function copy(token: string) {
    void navigator.clipboard.writeText(`${origin}/v/${token}`)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border
                      bg-background shadow-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Share Model</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-xs">{modelName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Create new link */}
        <div className="px-4 py-3 border-b border-border shrink-0 flex gap-2">
          <input
            type="text"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
            className="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm
                       focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            className="h-8 px-3 rounded-md text-sm bg-primary text-primary-foreground
                       hover:bg-primary/90 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {creating ? '…' : '+ New link'}
          </button>
        </div>

        {/* Link list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
              Loading…
            </div>
          )}
          {!loading && links.length === 0 && (
            <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
              No share links yet
            </div>
          )}
          {links.map((link) => (
            <div key={link.token}
              className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 group">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{link.label ?? 'Untitled link'}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {origin}/v/{link.token}
                </p>
              </div>
              {/* WhatsApp share */}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${origin}/v/${link.token}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Share via WhatsApp"
                className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-[#25D366]/15 transition-colors"
              >
                <svg viewBox="0 0 32 32" className="w-4 h-4 fill-[#25D366]" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16.003 2.667C8.639 2.667 2.667 8.64 2.667 16c0 2.347.638 4.639 1.847 6.64L2.667 29.333l6.88-1.813A13.277 13.277 0 0 0 16.003 29.333C23.36 29.333 29.333 23.36 29.333 16S23.36 2.667 16.003 2.667zm0 24.267a11.01 11.01 0 0 1-5.627-1.547l-.4-.24-4.08 1.08 1.093-4-.267-.413A10.96 10.96 0 0 1 5.003 16c0-6.067 4.933-11 11-11s11 4.933 11 11-4.933 11-11 11zm6.04-8.253c-.333-.167-1.96-.96-2.267-1.067-.306-.107-.52-.16-.747.16-.226.32-.866 1.067-1.066 1.28-.2.213-.4.24-.733.08-.333-.16-1.413-.52-2.693-1.653-.993-.893-1.667-1.987-1.867-2.32-.2-.333-.02-.507.147-.667.147-.147.333-.373.507-.56.173-.187.226-.32.333-.533.107-.213.053-.4-.027-.56-.08-.16-.747-1.787-1.027-2.44-.267-.64-.547-.547-.747-.56-.2-.013-.413-.013-.627-.013s-.573.08-.88.387c-.306.307-1.146 1.12-1.146 2.72s1.173 3.16 1.333 3.373c.16.213 2.28 3.547 5.547 4.827.773.32 1.373.507 1.84.653.773.24 1.48.2 2.04.12.613-.093 1.96-.8 2.24-1.573.28-.773.28-1.44.2-1.573-.08-.147-.307-.227-.64-.387z"/>
                </svg>
              </a>
              {/* Gmail share */}
              <a
                href={`https://mail.google.com/mail/?view=cm&fs=1&body=${encodeURIComponent(`${origin}/v/${link.token}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Share via Gmail"
                className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-[#EA4335]/15 transition-colors"
              >
                <svg viewBox="0 0 32 32" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.667 8.667v14.666C2.667 24.8 3.867 26 5.333 26H8V15.04L16 20.8l8-5.76V26h2.667c1.466 0 2.666-1.2 2.666-2.667V8.667L16 17.333 2.667 8.667z" fill="#EA4335"/>
                  <path d="M29.333 6H2.667L16 14.667 29.333 6z" fill="#FBBC05"/>
                </svg>
              </a>
              <button
                onClick={() => copy(link.token)}
                className="shrink-0 h-7 px-2 rounded text-xs border border-input
                           hover:bg-accent transition-colors"
              >
                {copied === link.token ? '✓ Copied' : 'Copy'}
              </button>
              <button
                onClick={() => void handleDelete(link.token)}
                className="shrink-0 opacity-0 group-hover:opacity-100 h-7 w-7 flex items-center
                           justify-center rounded text-muted-foreground hover:text-destructive
                           hover:bg-destructive/10 transition-all text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
