# Web Switcher public site and registry desk

React/TypeScript application with a public hostname-only lookup and moderated report form; a session-authenticated review queue; separate catalog publication; and a readable audit trail. Public copy distinguishes registry authenticity, continuity evidence, and website safety.

## Develop

Requires Node 22.12+ and the backend demo running on `127.0.0.1:8080`.

```sh
cd apps/web
npm ci --cache /tmp/web-switcher-npm-cache
npm run dev
```

Vite listens on port 5173, bound to loopback, and forwards `/v1`, `/health`, `/oauth2`, and `/login/oauth2` to the backend. Production serves built `dist/` assets behind the same-origin proxy in `infra/`; no API token is embedded in the client. Authentication uses HttpOnly server sessions and the current session's CSRF token. Credentials and tokens are not stored in localStorage.

The `#admin` view offers local credentials only when the server explicitly reports `demo: true`. Production offers the configured OIDC authentication entrypoint. Reviewer and publisher permissions are enforced by the API; disabling a control in the UI is only a usability aid.

## Check

```sh
npm run build
npm run test:browser
```

The browser smoke starts Vite and uses a real Chromium with intentionally mocked API responses. It tests hostname-only transmission, local rejection of full URLs, report moderation copy, rendering untrusted evidence as text, CSRF, reason/version review, role-separated publication, audit display, and a narrow mobile viewport. It is **not** a backend authorization test.

Set `CHROMIUM_PATH` if Chromium is installed somewhere other than `/usr/bin/chromium`.

With the real demo backend and Vite already running, run:

```sh
node tests/live-browser.mjs
```

This read-only integration check compares the displayed lookup with current API state, signs into separate demo reviewer/publisher sessions, reads their queues/publications/audit, and signs out. It does not create reports, approve candidates, or publish releases. Browser screenshots are written to `/tmp/web-switcher-home.png` and `/tmp/web-switcher-admin.png` for local inspection.

Owner continuity remains experimental: the site links to the signing tools and explains bootstrap/recovery limits rather than presenting a working enrollment portal. Research studies, browser stores, production OIDC/hosting, accessibility audits with assistive technology, and live owner pilots require their own validation.
