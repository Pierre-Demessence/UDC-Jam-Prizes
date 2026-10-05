# Deploy — the prize app on the Corniland cluster

## Goal

Package the app as a container and run it on the existing cluster through the ArgoCD GitOps repo: one
stateful pod (Node process + SQLite on a PersistentVolumeClaim) behind Traefik with a Let's Encrypt
certificate, its three secrets read from 1Password by External Secrets, and its image built and pinned
by GitHub Actions.

## Acceptance criteria

- WHEN a commit lands on `main`, THE SYSTEM SHALL build and push
  `ghcr.io/<owner>/udc-jam-prizes:<short-sha>` and commit that tag into `k8s/prod/deployment.yaml`.
- WHEN ArgoCD syncs the app, THE SYSTEM SHALL run exactly one pod, recreated on update rather than
  overlapped, with `/data/prizes.sqlite` on a PersistentVolumeClaim.
- IF the SQLite file becomes unreadable while the pod runs, THEN `/api/health` SHALL answer 503 and the
  readiness probe SHALL take the pod out of the Service endpoints.
- IF the database cannot be opened at startup, THEN the process SHALL exit with a visible error rather
  than serve requests — a crash loop, which is all a process that cannot reach its database can do.
- WHILE `NODE_ENV=production`, THE SYSTEM SHALL serve over HTTPS, because the session cookie is
  `Secure` in production (`server/config.ts`) and would never be sent over http.
- THE SYSTEM SHALL read `ADMIN_PASSWORD`, `SESSION_SECRET` and `KEY_ENCRYPTION_SECRET` from a
  1Password entry through an `ExternalSecret`, and SHALL NOT put them in the image or a ConfigMap.
- WHILE `KEY_ENCRYPTION_SECRET` is unchanged, THE SYSTEM SHALL keep every stored key readable across
  restarts and pod reschedules.
- IF the image lacks `drizzle/` beside `server/`, THEN the pod SHALL fail at startup, visibly, rather
  than serve a request against a stale schema.

## Design

### Container image (this repo)

`Dockerfile`, multi-stage on `node:24-bookworm-slim`: Node 24 clears the ≥ 23.6 floor that native
TypeScript support needs (`package.json`).

- **toolchain** — the base plus `python3 make g++`. It exists because the build failed without a
  compiler: `better-sqlite3` ships no prebuilt binary for Node 24, so npm falls back to `node-gyp`.
  This stage is what keeps the toolchain out of the final image.
- **deps** — `npm ci` (all dependencies, so the native module compiles once) and **build** —
  `COPY . .`, `npm run build` (`tsc --noEmit` + `vite build` → `dist/`).
- **runtime-deps** — `npm prune --omit=dev`, which drops vite, TypeScript, ESLint and Vitest without
  touching the compiled binary.
- **runtime** — `node:24-bookworm-slim` again, with `node_modules` from `runtime-deps`, `dist/` from
  `build`, and this repo's `server/`, `drizzle/`, `package.json`. Non-root uid/gid 1001.
  `CMD ["node", "server/index.ts"]` rather than `npm start`, so there is no `.env` lookup; the cluster
  supplies the environment.
- `PORT=3001`, `NODE_ENV=production`, `DATABASE_PATH=/data/prizes.sqlite` (the PVC mount), and
  `TRUSTED_PROXY_ALLOWLIST=10.42.0.0/24`, the node's pod range: the app believes `X-Forwarded-For`
  only from a listed address, so it reads visitors rather than the ingress pod.
- The server binds every interface already: `@hono/node-server` calls `listen(port, undefined)`, so no
  code change is needed. Proved with a real request against the container, not by reading.
- **`.dockerignore` is written before the first build.** Without it `COPY . .` bakes `.env` and
  `data/prizes.sqlite` — real key ciphertext — into the image layers.

### Manifests (this repo, `k8s/prod/`)

Mirroring `GameJams-Organizer-2/k8s/prod/app.yaml`, which is the closest analogue (a web app on this
cluster).

| File | Contents |
| --- | --- |
| `pvc.yaml` | `jam-prizes-data`, 1 Gi, `ReadWriteOnce`, no explicit StorageClass (as `gamejams-postgres`) |
| `deployment.yaml` | one pod, `Recreate`, the SecurityContext and env below |
| `service.yaml` | ClusterIP, port 80 → `targetPort: http` |
| `ingress.yaml` | Traefik, `cert-manager.io/cluster-issuer: letsencrypt-prod`, TLS secret `jam-prizes-tls` |
| `externalsecret.yaml` | `ClusterSecretStore/onepassword`, one item → Secret `jam-prizes` |

Deployment specifics:

- `replicas: 1`, `strategy: Recreate`, `terminationGracePeriodSeconds: 30` — the app closes the HTTP
  server and the database on SIGTERM (`server/index.ts`), and `Recreate` is what keeps a second pod
  from arriving on a volume only one may mount.
- Pod SecurityContext: `runAsNonRoot`, `runAsUser`/`runAsGroup` 1001, `fsGroup: 1001` so the SQLite
  file is writable, `seccompProfile: RuntimeDefault`. Container: `allowPrivilegeEscalation: false`,
  `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]`, with a `/tmp` `emptyDir`.
- Resources: requests 50m / 128Mi, limits 500m / 512Mi.
- Env: `NODE_ENV=production`, `PORT=3001`, `DATABASE_PATH=/data/prizes.sqlite`,
  `TRUSTED_PROXY_ALLOWLIST=10.42.0.0/24` (the node's pod range, so the ingress may name the caller),
  and `envFrom` the Secret.
- Probes: startup 2s × 30 and readiness every 10s on `/api/health` (`server/app.ts:139`) — the slack
  covers migrations running at boot on a cold volume — and liveness as a **TCP** check on the port, so
  a database hiccup takes the pod out of the Service instead of restarting it.
- Image tag: the committed value is `:latest` with `imagePullPolicy: Always`, and the first deploy pins
  an immutable short SHA — the same arrangement as `gamejams/app.yaml`.

**Deliberate deviations from the generic manifest checklist:** one replica, `Recreate`, no PodDisruptionBudget,
no anti-affinity, no autoscaler. SQLite is a single writer on a `ReadWriteOnce` volume, so a second pod
is a fault, not redundancy; a PDB over one replica would only block drains. The house pattern for a
stateful service is exactly this (`UDC-Bot/k8s/prod/bot.yaml`).

### CI/CD (this repo, `.github/workflows/`)

One workflow, `.github/workflows/deploy.yml`, with two jobs:

- **build** — triggered by the CI workflow completing successfully on `main` (`workflow_run`,
  `if: conclusion == 'success'`), checking out `head_sha`: buildx, GHCR login, push `:<short-sha>` and
  `:latest`, registry build cache.
- **pin** — rewrite the image tag in `k8s/prod/deployment.yaml`, **verify the substitution landed** and
  fail otherwise, commit and push.

UDC-Bot splits the same steps into a reusable `build.yml`/`deploy.yml` pair because four workflows
share them; with one environment that indirection buys nothing, so this is one workflow with the same
jobs. Two details are deliberate: deploying only after CI passes (UDC-Bot's build job pushes an image
without ever running the tests, so a red build still ships), and `[skip ci]` on the pin commit —
unnecessary while the push uses the default token, which starts no workflows at all, but load-bearing
the moment a GitHub App token is used, because that does trigger CI and would loop back into this
workflow. The tag substitution matches any owner so the manifest survives the repo moving.
Existing `ci.yml` stays the gate and already exercises `npm start` plus `/api/health`.

### GitOps (`Corniland-K8sCluster`)

One new file, `argocd/applications/jam-prizes-prod.yaml`, copied from `udc-bot-prod.yaml`: the Discord
notification annotations, the `resources-finalizer`, `CreateNamespace=true`, `repoURL` = this repo,
`path: k8s/prod`, `namespace: jam-prizes-prod`. `root.yaml` already syncs that directory, so nothing
else changes.

### Secrets (1Password, by hand)

A new item, e.g. `jam-prizes-prod` in the `UDC` vault, with `admin-password`, `session-secret` and
`key-encryption-secret` (32+ characters, generated once with
`crypto.randomBytes(32).toString('hex')`).

**`KEY_ENCRYPTION_SECRET` is irreplaceable.** Losing or rotating it makes every stored key unreadable:
it must exist in 1Password *before* the first key is stored, and a copy must live outside the cluster.
A Velero snapshot or a PVC copy does not protect it, because it is not on the volume.

### Backups

The cluster already runs Velero, which covers the volume. Two things to know and one to defer: a WAL
SQLite database copied while hot can be inconsistent, so the WAL-safe routine (`VACUUM INTO` from a
CronJob) goes to `docs/backlog.md` rather than this plan; and a restore is worthless without the
encryption secret above.

### Admin reachability

`ADMIN_IP_ALLOWLIST` stays **unset**: pinning the admin at the edge (a Traefik `ipAllowList` middleware
on `/admin`, `/api/admin/*`, `/api/session`, `/api/metadata`) would bar the admin from every network but
the listed one, and the password plus the login rate limiter are the door instead (`docs/decisions.md`).

What the Deployment does pass is `TRUSTED_PROXY_ALLOWLIST`, set to the node's pod range. Without it the
app reads every request as coming from the ingress pod, so one attacker could spend the login limit for
everyone and each client shared a single rate-limit key; with it, the limiter counts real clients, and
the in-app allow-list becomes usable the same way should it ever be wanted.

### Docs

- `README.md` — a "Deploying" section: the image, the three secrets, the `/data` volume, the
  one-replica/`Recreate` constraint.
- `AGENTS.md` — `k8s/` and the workflows in Layout, the image build in Commands.
- `docs/decisions.md` — why one replica and `Recreate`, and the SQLite-on-a-PVC shape.
- `docs/backlog.md` — the WAL-safe backup CronJob.

## Prerequisites (blocking, need your input)

1. **Push this repo.** `github.com/Pierre-Demessence/UDC-Jam-Prizes` exists and is public (so ArgoCD
   needs no credentials for it, and its default branch `main` is what the Application targets), but the
   working copy still has no remote: nothing is on GitHub yet, and ArgoCD cannot read `k8s/prod/` until
   the code is pushed.
2. **Hostname**: `prizes.jam.udc.ovh` (confirmed). A DNS record for it has to point at the cluster's
   ingress, or cert-manager's HTTP-01 challenge never completes.
3. **GHCR package visibility.** A package starts private even from a public repo, and the manifest
   carries no `imagePullSecrets` (the siblings carry none either, so their packages are public). After
   the first workflow run, set `udc-jam-prizes` to public, or the pod ends in `ImagePullBackOff` and a
   pull secret has to be added instead.
4. **`APP_ID` / `APP_PRIVATE_KEY`** if `main` is branch-protected. The workflow as written pushes with
   the default token only, so bypassing protection means copying UDC-Bot's app-token steps in — a code
   change, not just secrets.
5. **Prod only, or dev and prod** like the other apps? This plan does prod only; a dev environment is a
   second PVC, a second secret item and a second Application.
6. **Docker locally**, to build and run the image once before anything is pushed.

## Checklist

- [x] `.dockerignore` (excluding `node_modules`, `dist`, `data`, `.env*`, `.git`, `.github`, `docs`,
      `coverage`, `.eslintcache`, `.vscode`)
- [x] `Dockerfile` — `toolchain` → `deps` → `build` → `runtime-deps` → `runtime`, non-root 1001,
      `drizzle/` and `dist/` present, no toolchain and no devDependencies in the final image
- [x] Build and run the image locally: `/api/health` answers and `GET /` is 200, no `.env` and no
      database in the image, the SQLite file is written to the mounted volume by uid 1001, and a
      restart comes back on the same database. Run under `--read-only --tmpfs /tmp`. The volume was
      chowned by hand first, so this does **not** prove the cluster applies `fsGroup` — the item below
      does.
- [x] `k8s/prod/pvc.yaml`
- [x] `k8s/prod/deployment.yaml`
- [x] `k8s/prod/service.yaml`
- [x] `k8s/prod/ingress.yaml`
- [x] `k8s/prod/externalsecret.yaml`
- [x] Validate the manifests: every file parses, and a check asserts the cross-references (probe path,
      port name, claim name, secret name, namespaces, selector and backend targets). `kubectl` and
      `kubeconform` are not installed here, so cluster-side validation is the first ArgoCD sync
- [x] `.github/workflows/deploy.yml` (build and pin, triggered by CI succeeding)
- [ ] Create the 1Password item with the three fields
- [ ] Push the repo to GitHub (remote + first push) — needs your go-ahead
- [x] Write `argocd/applications/jam-prizes-prod.yaml` in the GitOps repo for
      `Pierre-Demessence/UDC-Jam-Prizes` — written, left uncommitted for you
- [ ] Commit it there and push this repo, then watch the first sync: pod Running, `/api/health` ok
      through the Ingress, certificate issued
- [ ] Confirm on that sync that the pod can write `/data`. If it cannot — a provisioner that ignores
      `fsGroup` leaves the volume root-owned and the container exits with `SQLITE_CANTOPEN` — the
      fallback is what UDC-Bot does: add the `DAC_OVERRIDE` capability, or chown the volume from an
      init container.
- [ ] Sign in to `/admin` over HTTPS and store one test key, then restart the pod and confirm the key
      still reads — that is the encryption-on-the-volume proof
- [x] Docs: `README.md`, `AGENTS.md`, `docs/decisions.md`, `docs/backlog.md`
- [x] Peer review pass (read-only subagent). Acted on: liveness moved off the database endpoint, no
      service-account token, the pin job rebases before pushing, a manual dispatch builds `main`, and
      the `[skip ci]` / `APP_ID` claims corrected. Not verifiable here: whether the cluster's
      provisioner honours `fsGroup` (no kubeconfig), so it is a first-sync check with a fallback.

## First sync (runbook)

Point-in-time, like the rest of this plan: the durable facts live in `README.md` and `docs/decisions.md`,
so nothing here has to be kept once the deploy is up.

### 1. Before touching the cluster

- DNS: `prizes.jam.udc.ovh` must resolve to the cluster's ingress address (the one behind
  `argocd.vps.corniland.ovh`) — `Resolve-DnsName prizes.jam.udc.ovh`. Without it, cert-manager's HTTP-01
  challenge cannot complete and no certificate is issued.
- Traefik must be the default IngressClass, since the Ingress names no class: `kubectl get ingressclass`.
- Note the default StorageClass and its provisioner (`kubectl get storageclass`). A CSI driver decides
  for itself whether it applies `fsGroup`; a `local-path` or hostPath provisioner leaves it to the
  kubelet. This is the step-5 question.

### 2. The 1Password item

A new item titled exactly `jam-prizes-prod` in the `UDC` vault. The `ClusterSecretStore` maps two vaults
(`UDC: 1`, `K8S: 2`), the `ExternalSecret` names no vault, so the title must be unique across both.
Three fields, whose **labels are the `property` values** in `k8s/prod/externalsecret.yaml`:

| Field label | Value |
| --- | --- |
| `key-encryption-secret` | 32+ characters, generated once: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `admin-password` | the login password |
| `session-secret` | 16+ characters: `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"` |

Run those commands in your own terminal. **`key-encryption-secret` must never be rotated once a key is
stored** — it is the only thing that can open the stored keys, and no volume snapshot replaces it. If the
field labels differ, either rename them or change `externalsecret.yaml` to match.

### 3. Push, and let CI do its work

Push `main` to `Pierre-Demessence/UDC-Jam-Prizes`. CI runs (lint, test, build, and a `npm start` health
check), then `deploy.yml` fires on its success: it builds the image, pushes
`ghcr.io/pierre-demessence/udc-jam-prizes:<short-sha>`, and commits the pinned tag into
`k8s/prod/deployment.yaml`.

Then set the package public — GitHub → Packages → `udc-jam-prizes` → Package settings → Change
visibility. Packages start private even from a public repo and the manifest carries no
`imagePullSecrets`; skip this and the pod sits in `ImagePullBackOff`.

### 4. Let ArgoCD in

Commit `argocd/applications/jam-prizes-prod.yaml` in the GitOps repo. The `root` Application already
syncs `argocd/applications/`, so it creates `jam-prizes-prod` from `k8s/prod` on the app repo's `main`.

### 5. Watch it, in this order

```sh
kubectl -n argocd get application jam-prizes-prod -o wide
kubectl -n jam-prizes-prod get pods,pvc,externalsecret,ingress
kubectl -n jam-prizes-prod get secret jam-prizes -o name            # exists; values never printed
kubectl -n jam-prizes-prod get deploy jam-prizes -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl -n jam-prizes-prod logs deploy/jam-prizes
kubectl -n jam-prizes-prod get certificate,challenge                # cert-manager progress
kubectl -n jam-prizes-prod get events --sort-by=.lastTimestamp | Select-Object -Last 20
```

The known trap is the volume: if the provisioner ignores `fsGroup`, the database cannot be created and
the container exits with `SQLITE_CANTOPEN` in a crash loop. Prove the write path directly:

```sh
kubectl -n jam-prizes-prod exec deploy/jam-prizes -- id             # expect uid=1001(app)
kubectl -n jam-prizes-prod exec deploy/jam-prizes -- ls -ld /data   # expect it writable by 1001
kubectl -n jam-prizes-prod exec deploy/jam-prizes -- touch /data/.probe
kubectl -n jam-prizes-prod exec deploy/jam-prizes -- rm /data/.probe
```

If it fails, the fallback is what UDC-Bot does: add the `DAC_OVERRIDE` capability to the container's
securityContext, or chown the volume from an init container.

### 6. Through the edge

```sh
curl.exe -s https://prizes.jam.udc.ovh/api/health                     # {"database":"ok",…}
curl.exe -s -o NUL -w '%{http_code}' https://prizes.jam.udc.ovh/      # 200
```

Then the end-to-end proof: sign in at `https://prizes.jam.udc.ovh/admin`, paste a test asset and one test
key, delete the pod (`kubectl -n jam-prizes-prod delete pod -l app.kubernetes.io/name=jam-prizes`), and
reload the admin page once the new pod is ready — the key must still read. That single check covers the
volume *and* `KEY_ENCRYPTION_SECRET` surviving a restart.

### Rollback

`kubectl -n jam-prizes-prod rollout undo deploy/jam-prizes` returns the previous image; the schema does
not come back with it (forward-only migrations, `docs/backlog.md`).

Status: the repo side is implemented and verified locally (image run the way the pod runs it, manifests
cross-checked, peer review done), the hostname is `prizes.jam.udc.ovh` (its DNS record still has to
point at the cluster), the app repo exists and is public (`main`, matching the Application), and the
ArgoCD Application is written in the GitOps repo. Still open and needing you: pushing this repo (no
remote in the working copy), the 1Password item, committing the Application, and setting the GHCR
package public after the first run. Nothing has been pushed or committed anywhere yet.
