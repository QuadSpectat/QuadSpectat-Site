# Caching /_viewer assets (proposal)

State today: App Platform static sites serve everything under `/_viewer` with `Cache-Control: public,max-age=10,s-maxage=86400`.
The official app spec reference documents only CORS for static sites; a per-path `headers`/Cache-Control key is not documented
(a third-party blog shows one, unverified; a DigitalOcean ideas thread asks for it). Not changed or tested here.

What the code now guarantees, so long caching is safe the moment a header can be set:

- `assets/*` are content-hashed (Vite). Safe: `public, max-age=31536000, immutable`.
- The Cesium engine lives in a versioned directory, `/_viewer/cesium-<version>/` (version read from node_modules/cesium). Safe: the same immutable policy.
- `index.html` is the only file that must stay revalidated (`no-cache`).

Infrastructure options (need owner approval; none applied):

1. Test the documented/undocumented `headers:` block on the `viewer` static site in a throwaway app. If honoured, add the rules above.
2. Serve `/_viewer/*` from the Spaces CDN (build with `VITE_BASE=https://<cdn-host>/_viewer/`, upload `dist/_viewer`
   with `Cache-Control: public,max-age=31536000,immutable` object metadata; Cesium needs CORS `*` for workers/fetches). `index.html` stays on App Platform.
3. Put a CDN/proxy (e.g. Cloudflare, already in front per CF-RAY) in front with a Cache Rule: `/_viewer/assets/*` and `/_viewer/cesium-*/*` edge+browser TTL 1 year.
   This works even if App Platform cannot set headers.
