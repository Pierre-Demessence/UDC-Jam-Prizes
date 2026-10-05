# Deployment

Where the app runs, what it needs, and how to bring it back.

## What runs

| Piece | Where |
| --- | --- |
| Pod | `jam-prizes-prod`, one replica, `Recreate` |
| Image | `ghcr.io/pierre-demessence/udc-jam-prizes:<commit>`, pinned in `k8s/prod/deployment.yaml` |
| Manifests | `k8s/prod/` in this repo, synced by ArgoCD (the `Application` lives in the GitOps repo) |
| Host | `prizes.jam.udc.ovh`, certificate issued by cert-manager with `letsencrypt-prod` |
| Database | the SQLite file on the PersistentVolumeClaim, at `/data/prizes.sqlite` |

`/api/health` is the deployment's own signal: 200 when the database opens, 503 when it does not.
Readiness uses that endpoint; liveness is only a TCP check, so a database problem takes the pod out of
the Service instead of restarting it.

## Secrets

`jam-prizes` is an `ExternalSecret` (`k8s/prod/externalsecret.yaml`) mirroring the 1Password item
**`jam-prizes-prod`** in the `UDC` vault. The field labels are the `property` values in that file:

| 1Password field | What it is |
| --- | --- |
| `key-encryption-secret` | 32+ characters; encrypts donated key values at rest |
| `admin-password` | the admin login |
| `session-secret` | 16+ characters; signs the session cookie |

**`key-encryption-secret` never changes.** Every key value in the database is ciphertext under it, so
rotating or losing it makes the whole key list unreadable, with no way back: the fingerprint that
recognises a repeated key is a one-way derivation of the same secret, not a copy of the key.

## Operating it

```sh
kubectl -n jam-prizes-prod get pods
kubectl -n jam-prizes-prod logs deploy/jam-prizes
kubectl -n jam-prizes-prod describe pod -l app.kubernetes.io/name=jam-prizes   # pull or probe failures
kubectl -n jam-prizes-prod exec deploy/jam-prizes -- ls -l /data               # the volume it writes
```

An image goes back by reverting the pin commit in `k8s/prod/deployment.yaml` and pushing it: CI writes
that tag and ArgoCD syncs the file, so a bare `kubectl rollout undo` would be undone at the next sync.
The schema does not come back with the image — migrations run forward at every startup
(`docs/backlog.md`).

## Backups and restores

Velero covers the volume: its cluster-wide schedule takes every namespace except `monitoring`, with
kopia copying volumes (`defaultVolumesToFsBackup`), and keeps them 30 days (`ttl: 720h`) — that is the
restore window. Two things are specific to this database:

- A copy of a write-ahead-log SQLite file taken while the app is writing can be inconsistent. A copy
  meant to be restored needs a checkpoint — `VACUUM INTO` from a `sqlite3` client — not `cp`.
- **Restoring the volume does not restore the keys.** The file holds ciphertext, so a restore is only
  useful together with `key-encryption-secret` from 1Password. Keep a copy of that item outside the
  cluster: no snapshot of the volume can stand in for it.

## Cluster facts that are easy to get wrong

- `TRUSTED_PROXY_ALLOWLIST=10.42.0.0/24` is the node's pod range, which is where the ingress pod's
  address comes from. Each further node needs its own range added, or the app goes back to reading
  every visitor as the proxy — one shared rate-limit key, and the login limiter spending everyone's
  budget at once.
- The admin is pinned at the edge: `k8s/prod/ingress-admin.yaml` routes `/admin`, `/api/admin`,
  `/api/session` and `/api/metadata` through Traefik's `default-ip-allowlist` middleware, while the
  gallery's own Ingress stays open. `ADMIN_IP_ALLOWLIST` is unset because the edge is both the accurate
  and the only per-path place to do it (`docs/decisions.md`). The middleware's `sourceRange` holds a
  single address — from any other network the admin refuses you, and the way back in is editing that
  middleware in the GitOps repository.
- One replica with `Recreate` is on purpose: SQLite is a single writer on a `ReadWriteOnce` volume
  (`docs/decisions.md`).
- The gallery's Ingress carries Traefik's rate limit, so a `429` at the edge is Traefik refusing load,
  not the app refusing a request — the app limits logins only.
