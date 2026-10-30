# 0021. The dashboard is a Panneau 5 app, served by Eclair

- Status: Proposed
- Date: 2026-10-30

## Context

Operators run a shared Eclair with the CLI, the admin API, `/metrics` and the logs ([running.md](../running.md)). Seeing the queues, finding a project's failed jobs, revoking a key or comparing the projects' usage takes several commands, or a Prometheus and a Grafana that small installs don't have.

Panneau 5 (`@panneau/*`, folkloreinc/panneau-js) is the admin toolkit of the applications that use Eclair. Its app reads a definition (resources, fields, lists, actions, menus, pages) and talks to its backend through a `DataAdapter` that runs in the browser. Laravel is the default backend; other backends pass their own adapter ([its decision 0019](https://github.com/folkloreinc/panneau-js/blob/v5.x/docs/decisions/0019-app-entry.md)). Its dashboard widgets come after 5.0. Until then, plugins add pages.

## Decision

- **A new package, `@eclair-js/dashboard`**, in this monorepo. It is a Panneau 5 app (`@panneau/app`, `@panneau/ui`), built with Vite, published with the other packages.
- **An Eclair `DataAdapter`**, not Panneau's protocol on the server:
    - The definition is static, in the package: projects, keys, storages, presets and jobs as resources, with their lists, forms and actions (revoke a key, rotate a webhook secret, cancel or retry a job, disable a project).
    - The adapter maps them onto `/admin/v1`. The server knows nothing about Panneau.
- **Plugin pages** for what isn't a resource: the overview (health, queues, stats), a job's detail with its tasks' timeline, and usage and costs. They move to Panneau's dashboard widgets when those exist.
- **Served by the API at `/dashboard`**:
    - The built files ship in the image.
    - The page is on when `ECLAIR_ADMIN_TOKEN` is set, and `ECLAIR_DASHBOARD=false` turns it off.
    - Same origin as the API, so there is no CORS.
    - A strict Content Security Policy: no third-party script, style or font.
- **Signing in is the admin token**:
    - The operator pastes it on the login page.
    - It is kept in `sessionStorage`, for the tab only, and sent as a bearer token, never as a cookie, so there is nothing to forge across sites.
    - Accounts per operator (OpenID Connect) would be a decision of their own.
- **The admin API grows for it**, additively, protocol first:
    - jobs of every project, and their cancel and retry;
    - a job's webhook deliveries;
    - the server's status;
    - stats over a period;
    - `lastUsedAt` on keys;
    - a storage access check.

    Other clients of the admin API get them too.

- **English and French**, through Panneau's intl.

## Consequences

- The server doesn't depend on Panneau. Only the dashboard does, at Panneau's 5.0 alphas: their changes are absorbed in this package, and the image pins the version it built.
- Eclair is the first Panneau 5 app on a backend other than Laravel. Limits found on the way become issues on `folkloreinc/panneau-js`.
- An operator who can open the dashboard holds the admin token: the same trust as the CLI and the admin API, no more.
- Without the dashboard (`ECLAIR_DASHBOARD=false`, or no admin token), nothing changes for an install.
