# @eclair-js/dashboard

The operations dashboard of [Eclair](https://github.com/urbania-media/eclair): a [Panneau 5](https://github.com/folkloreinc/panneau-js) app on the admin API (`/admin/v1`), in English and French ([decision 0021](../../docs/decisions/0021-dashboard-on-panneau.md)).

Eclair implements no Panneau protocol. The dashboard ships a static definition and a Panneau `DataAdapter` that maps it onto the admin API, with the admin token as a bearer token. Operators sign in by pasting the server's `ECLAIR_ADMIN_TOKEN`, which stays in the tab's `sessionStorage` until they close it or sign out.

## Build and development

```bash
npm run build -w @eclair-js/dashboard   # dist/app: the static app, for /dashboard/
npm run dev -w @eclair-js/dashboard     # Vite at http://localhost:5173/dashboard/
```

The dev server sends `/admin` to a local Eclair: `ECLAIR_URL`, `http://127.0.0.1:8080` by default, started with an `ECLAIR_ADMIN_TOKEN`.

## The adapter

The package also exports the adapter, for an app of its own:

```ts
import { createEclairAdapter, createTokenStore } from '@eclair-js/dashboard';

const adapter = createEclairAdapter({ tokens: createTokenStore(), locale: 'en' });
await adapter.login({ email: '', password: adminToken });
```

- **Errors.** The admin API's problem details become Panneau's errors (`UnauthorizedError`, `ValidationError`…), with validation errors keyed by dot path (`settings.concurrency`) instead of JSON pointer (`/settings/concurrency`).
- **Sign-in.** `login()` takes the admin token as the `password` and keeps it once the server accepts it. `logout()` forgets it.
- **Plugin pages** read their data with `getWidgetData('name?query')`, through the adapter, until Panneau has dashboard widgets.
