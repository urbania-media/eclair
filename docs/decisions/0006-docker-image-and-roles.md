# 0006: One Docker image with api and worker roles, queues per capability

- Status: accepted
- Date: 2026-10-15

## Context

Eclair must be simple to deploy on one server and to spread over several. Media binaries and their versions are the hardest part of a setup. Some operations need a GPU or a lot of memory and shouldn't run everywhere.

## Decision

- Eclair ships as **one Docker image**, with every binary the built-in operations need, at pinned versions. A `-gpu` variant adds CUDA builds.
- The image runs as `api`, `worker` or `all`, and contains the `eclair` CLI.
- Each operation declares a capability (`cpu`, `video`, `gpu`, `ai`), and each capability is a queue. Workers list the queues they serve.
- Workers share nothing but PostgreSQL, Redis and the project storages.
- A docker compose file covers the single-server setup. Installing without Docker is documented, not the default.

## Consequences

- Scaling out means starting the same image on another server.
- Heavy and GPU work goes to the servers that can run it, and waits rather than failing when none is available.
- The image is large. It is built and scanned in CI, and its binary versions are listed in each release.
