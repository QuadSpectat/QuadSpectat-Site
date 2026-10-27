/** Wraps menus that "Hide menus" (3D viewing) removes; the wrapper itself has no box, so layout is unchanged. */
export function Chrome({ children }: { children: React.ReactNode }) {
  return <div className="qs-chrome contents">{children}</div>
}
