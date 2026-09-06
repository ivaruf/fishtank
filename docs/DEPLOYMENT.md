# Deploying Fishtank

Created 2026-09-06. Hosted on Render, deployed from GitHub once the tests pass.

## The one constraint that shapes everything

Game rooms are an in-memory `Map` of live `World` objects inside a single
process. There is no shared store. So the service must run **exactly one
instance**: a second one would serve a second, separate "Aquarium 001", and two
players who picked the same tank would land in different worlds with no error
and no way to tell.

Consequences:

- **No autoscaling, ever.** Free plans are hard-capped at one instance, which
  happens to enforce this for us. On a paid plan, set `numInstances: 1` and
  leave it.
- **Serverless and edge hosts cannot run this.** Vercel, Netlify and Cloudflare
  Pages/Workers have no long-lived stateful process. Not a config problem.
- **Every deploy ends every live game.** The process restarts, rooms are gone,
  players land back on the menu. Deploy deliberately, not mid-match.

## First-time setup

1. Push to `main` on `github.com/ivaruf/fishtank`. `render.yaml` and
   `.github/workflows/ci.yml` need to be on the branch before step 2.
2. In Render: **Blueprints → New Blueprint Instance**, point it at the repo. It
   reads `render.yaml` and creates the `fishtank` web service.
3. On the service: **Settings → Deploy Hook**, copy the URL.
4. In GitHub: **Settings → Secrets and variables → Actions → New repository
   secret**, name `RENDER_DEPLOY_HOOK_URL`, paste the URL.
5. Push anything to `main`. The workflow runs the tests, then calls the hook.
6. Check `https://<service>.onrender.com/healthz` — it returns the live room
   list, not just a 200.

## Confirming a deploy landed

The menu shows `build <sha>` in the bottom right, fetched from `/healthz` and
never cached, so it is the build the server is actually running rather than
anything baked into the page. Hover it for the protocol number and the time
the process started, which also tells apart two deploys of the same commit.

It comes from `RENDER_GIT_COMMIT`, which Render sets for services built from a
repo. `APP_VERSION` overrides it on any other host, and locally the server
reads the checked-out commit from `.git` so the number matches
`git rev-parse --short HEAD`. If none of those work it says `build dev` rather
than inventing a version, and `build unknown` if the page cannot reach the
server at all.

Until step 4 is done the deploy job fails loudly rather than silently skipping,
so a red build there means "add the secret", not "the code is broken".

## Why the deploy is gated on CI

Render can auto-deploy on push by itself, but it does so whether or not the
tests pass, and a bad deploy takes the game down for everyone. So
`render.yaml` sets `autoDeploy: false` and the workflow's `deploy` job calls
the deploy hook after `npm test` and the formatting check are green. To go back
to unconditional deploys, set `autoDeploy: true` and delete the `deploy` job.

The CI job also smoke-tests the server the way the platform will: it starts it,
waits for `/healthz`, and asserts that `/` comes back compressed and
revalidates to an empty `304`.

## The free tier: what is and is not a problem

**Sleep is not the problem.** Render spins a free service down after 15 minutes
without inbound traffic, but its docs count "WebSocket messages from existing
connections" as inbound traffic. Players send input continuously and the
server's 15-second heartbeat draws a pong from every client, so **a game in
progress keeps the service awake**. An empty tank for 15 minutes will sleep,
and the next visitor waits about a minute — but the page load itself is an HTTP
request that wakes it, and the WebSocket only opens seconds later when they
press a button, so the handshake usually lands after it is up.

**CPU is the problem.** Free is 512 MB and **0.1 CPU** — a tenth of one core.
Measured on this repo:

| Load                | CPU with deflate | without |
| ------------------- | ---------------- | ------- |
| 24 players, 3 tanks | 25% of a core    | 6%      |
| 48 players, 3 tanks | 36% of a core    | 11%     |

Those were measured on a fast local core, so a shared Render slice is worse.
Even one full 16-player tank wants roughly twice the free tier's entire
allocation, and the cost is mostly per-client deflate plus the 30 Hz tick. Over
budget, the tick loop falls behind and the game gets laggy for everyone.

There is no way to win both on free: turning `perMessageDeflate` off drops CPU
to ~11% but pushes a full tank back to ~39 Mbit/s, which burns the included
bandwidth in hours rather than weeks.

**So: free is fine for a couple of friends testing, and will struggle with a
real crowd.** `plan: starter` ($7/mo) is 0.5 CPU — five times the CPU, above
the measured 36% peak — and never sleeps. It is a one-line change in
`render.yaml`; add `numInstances: 1` at the same time, because paid plans can
scale.

Also budget the **750 free instance-hours per workspace per month**. A service
kept awake 24/7 uses about 720, so one free service consumes essentially the
whole allowance on its own.

## Notes

- **WSS is automatic.** The client picks `wss://` under HTTPS and `ws://`
  otherwise, so a custom domain or the `.onrender.com` hostname both work with
  no config. Render proxies WebSockets natively.
- **The `/vendor/` Babylon fallback survives production.** `babylonjs` is a
  production dependency, so it is still installed when Render builds with
  `NODE_ENV=production` and `npm ci` skips devDependencies. The CDN path is
  primary; the local copy stays as the backstop.
- **The filesystem is ephemeral.** Nothing here writes to disk at runtime, so
  this only matters if that changes.
- **No reconnect logic.** A dropped connection sends the player back to the
  menu with a message rather than retrying. Worth adding if the service turns
  out to restart often.
- **The repo is ~76 MB tracked**, mostly the HD fish models, so every build
  clones that. Moving the models to object storage is the natural next step if
  builds get slow; see B3 in [the network worklist](NETWORK-WORKLIST.md).

## Commands

```sh
npm ci
npm test
npm run format:check
PORT=3000 npm start
curl -s localhost:3000/healthz
```
