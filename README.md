# PF2e Toolbox

The four Pathfinder 2e tools behind one name on the tailnet, so there's an
address you can send a player.

```
https://pf2e.<your-tailnet>.ts.net/            the landing page
                                  /primer/     PF2e Primer      — new players
                                  /spellbook/  PF2e Spellbook   — players
                                  /tracker/    PF2e Party Tracker — GMs
                                  /subsystems/ PF2e Subsystems  — GMs
```

Each tool is already a self-contained `dist/index.html`, so this repo is a
landing page, one file of stdlib Node that hands back files, and a Dockerfile.
No dependencies, no build step, no backend.

## The apps are submodules

```
apps/pf2epartytracker/   → github.com/TheWhyteWolf/pf2epartytracker
apps/pf2espellcards/     → github.com/TheWhyteWolf/pf2espellcards
apps/pf2eprimer/         → github.com/TheWhyteWolf/pf2eprimer
apps/pf2esubsystems/     → github.com/TheWhyteWolf/pf2esubsystems
```

Each is pinned at a commit, and only its committed `dist/` is served — the apps
build themselves in their own repos, and nothing is rebuilt here.

```sh
git clone --recurse-submodules https://github.com/TheWhyteWolf/pf2etoolbox.git
# or, in an existing clone:
git submodule update --init --recursive

# take one app's newest release:
git submodule update --remote apps/pf2eprimer
git commit -am "Bump the primer"
```

## Run it

```sh
node server.mjs                 # http://localhost:6670
node server.mjs --port 8000
node tools/test.mjs             # 106 assertions against a live server
```

## The two routing rules that matter

**`/tracker` redirects to `/tracker/`.** Each app calls
`navigator.serviceWorker.register("sw.js")`, which resolves against the
*document* URL. At `/tracker/` that gives `/tracker/sw.js` — scope `/tracker/`,
and no app can see a sibling. At `/tracker`, no slash, it resolves to `/sw.js`
— scope `/`, and that one worker then intercepts navigations for all four apps
while precaching the wrong shell. It fails silently and it sticks, so the
redirect is not cosmetic.

**`/pf2epartytracker/` redirects to `/tracker/`.** The primer links its siblings
relatively (`../pf2epartytracker/`) so the links resolve on GitHub Pages, where
the repo name is the path. The alias makes the same link work here.

Everything else was already subpath-clean: the apps' manifests use
`"start_url": "."` and `"scope": "."`, which resolve against the manifest's own
URL, and their service workers precache `"./…"` against the worker's URL.

## One thing to tell people

Browser storage is per **origin**, so a party built at `http://localhost:8725`
does not follow you here — this address starts empty. Each tool has an
export/import escape hatch; that's the migration path. From here on the four
share one origin's storage budget, and clearing site data for one clears all
four. Their keys don't collide (`pf2ePartyTracker.v1`, `pf2eSpellbook.v3`,
`pf2ePrimer.v1`, `pf2eSubsystems.v1`), so nothing overwrites anything.

## Deployment

The compose stack lives in the homelab repo at `stacks/pf2e/`, not here — this
repo describes the app, that one describes where it runs. A Tailscale sidecar
gives it its own node and a real certificate, which is what keeps the tools
installable as PWAs; the same stack publishes port **6670** for the house wifi.

Not 6666: Chrome and Firefox both hard-block 6665–6669 as the IRC range and
refuse the connection before making a request.

## Licensing

The tools carry their own licences in their own repos — MIT code, with Paizo
rules text under the ORC and OGL licences (see each repo's `notice.md`). The
landing page and server here are MIT. Unofficial fan tools, not affiliated with
Paizo.
