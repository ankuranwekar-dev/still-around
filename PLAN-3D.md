# Still Around — end-to-end build plan for a photoreal pet

Written 2026-08-18. Target: pets that read as **a real cat or a real dog**, animated
smoothly, sharp at any size. Executed in Cursor, by you plus its agent.

---

## 0. The finding this plan is built on

I rendered the current engine before writing anything (`ONLY=ginger,beagle
POSES=sit,walk node tools/sheet.js`). What it produces today is a competent
*stylised illustration*: clean anti-aliasing, markings correctly glued to body
coordinates, believable front-sit poses. The side views give it away — the torso
reads as a lozenge, legs as stubby cylinders, the beagle as a long loaf.

That is not a tuning deficit. It is the ceiling of the architecture:

| what photorealism needs | what a region-map painter can express |
|---|---|
| fur as strands with anisotropic scattering | a flat 4-stop colour ramp |
| light through an ear membrane, wet nose specular, corneal caustics | one silhouette-depth shading term |
| anatomy — scapula sliding under skin, ribcage, hock | unions of capsules and ellipses |
| secondary motion (fur drag, skin slide, weight shift) | keyframed pose numbers |
| resolution independence | a fixed grid, rasterised then upscaled |

**No amount of work on `painter.js` gets to "exactly like a real cat."** Reaching
your bar means replatforming the art to realtime 3D. Everything else you have
built — the analyzer, the shot list, the privacy promise, the `.pet` file, the
desktop overlay, the harness culture — survives intact and is genuinely the hard
half of the product. This plan replaces the renderer under it.

### The honest ceiling

With a licensed high-quality mesh, a real groom, shell fur and correct colour
management, at the 300–700px an overlay pet actually occupies, a viewer reads it
as a real animal. A 4K frozen close-up will not fool anyone, and it will be
*their breed and their colouring, recognisable* — not a forensic duplicate of
Momo. State that on the site. In a memorial app an overpromise hurts more than a
stylisation does.

### The pixelation cause, specifically

Not a filtering bug. `stage.js` renders each clip into a fixed grid (`gridFor` ×
quality, capped at 620 in `personas.js`), caches the frames as `ImageData`, then
scales them to the canvas. Any display size above the grid is an upscale, and
`quality = 0.55` in the desktop default means most of them are. In 3D the whole
class of problem disappears: you draw at `cssPixels × devicePixelRatio` every
frame, with a supersample multiplier on top.

---

## 1. Architecture

### Plan A — realtime 3D (recommended)

```
photos ──► analyzer (unchanged models) ──► appearance: ~45 numbers ──► .pet.json v2
                                                     │
                            ┌────────────────────────┼────────────────────────┐
                            ▼                        ▼                        ▼
                    morph targets            coat shader graph          fur params
                   (breed + build)         (pattern, masks, colour)   (length, density)
                            └────────────────────────┼────────────────────────┘
                                                     ▼
                              felis.glb / canis.glb  ·  skeleton  ·  groom
                                                     ▼
                              three.js  (WebGPURenderer → WebGL2 fallback)
                                                     ▼
                        web studio   ·   Electron overlay   ·   iOS (USDZ/SceneKit)
```

Principles carried over deliberately:

- **One engine, imported unmodified** by web and desktop. Same rule, new engine
  directory. `engine3/` alongside `engine/` until parity, then swap.
- **Appearance is numbers, not pixels.** ~45 instead of ~30. Photos still never
  leave the machine; `.pet.json` v2 is still a few hundred bytes and still
  emailable.
- **No image generators anywhere.** A generated still can't walk, blink or track
  a cursor, and it would be a generic cat. Unchanged — and now also true of
  neural texture synthesis, which would need a server.
- **No server.** Meshes and textures are static files on the same static host.

### Plan B — stay 2D, push to illustrated realism

Only if the art budget is genuinely zero. Spline silhouettes instead of capsule
unions, alpha fur fringe on the silhouette, three-band lighting with bounce,
hand-authored breed profiles instead of one parameterised cat. Ceiling: a
beautiful drawing. Cost: ~3 weeks. It does not meet the brief you wrote, and I'd
rather say so than quietly aim lower. Keep it as the fallback if §2 blocks.

### Technology choices, with reasons

| decision | choice | why |
|---|---|---|
| renderer | `three.js`, `WebGPURenderer` with WebGL2 fallback | WebGPU gives 30–50% on dense scenes plus compute for the fur and verlet passes; same API means the fallback is a flag, not a second engine. Still marked experimental — wire the fallback from day one and test both every phase |
| DCC | Blender, driven headless (`blender --background --python`) | the rig, groom and morph bake belong in scripts Cursor can run and re-run, not in remembered GUI clicks |
| transport | glTF 2.0 + Draco geometry + KTX2/Basis textures | one format the web, Electron and (via USDZ conversion) iOS all read |
| colour | linear working space, AgX or ACES tonemap, sRGB output | flat sRGB compositing is why CG fur looks like felt. This is also where the dark-coat luminance floor moves to |
| animation | skeletal, blend trees, inertialized transitions | replaces the frame flipbook entirely; smoothness stops being a cache-size question |
| fur | layered shells + fins on the body, alpha hair cards for ruff/tail/ear tufts | shells+fins is proven realtime in WebGL and degrades by shell count, which is your LOD ladder. Cards only where the silhouette does the work |

---

## 2. The gating decision: where the meshes come from — resolve this in week 1

This project becomes ~60% art and ~40% code the day you choose Plan A. Nothing in
phases 3+ can be judged without a base mesh. Three routes:

1. **License two rigged base meshes and re-groom them yourself.** Fastest to a
   look you can judge (days). Sketchfab Store, TurboSquid and CGTrader all carry
   game-ready rigged cats and dogs.
2. **Commission with full buyout.** Roughly $1.5–5k per species for mesh + UV +
   rig + groom from someone who has done animal work. Best result, 3–6 weeks
   lead time.
3. **CC0 base plus your own retopo, rig and groom.** Free, and the most work;
   CC0 animal meshes are usually generated and need real cleanup.

**The licence trap that will bite you:** most marketplace royalty-free licences
let you ship an asset *inside an application* but forbid redistributing it as a
standalone asset. Electron ships raw `.glb` inside the app bundle, your source is
MIT and public, and your installers are unsigned. That combination is
redistribution under a strict reading. So the licence must be one of: extended /
redistribution-permitting, a full-buyout commission, or CC0. Read the specific
licence before paying, and keep an `ASSETS.md` recording provenance and terms per
file. Decide this before writing shader code — Cursor cannot unblock it for you.

Sourcing references: [Sketchfab Store rigged
dog](https://sketchfab.com/3d-models/rigged-dog-c5748c5b91f245ddaa31febcebc493b0),
[TurboSquid rigged cats](https://www.turbosquid.com/3d-model/rigged/cat),
[CGTrader rigged cats](https://www.cgtrader.com/rigged-3d-models/cat),
[Meshy CC0 dog assets](https://www.meshy.ai/tags/dog).

---

## 3. Quality bar, made testable

"Highest order" has to become numbers or it will drift. These are the gates.

**Likeness**
- Blind test, five people, photo beside render: "same animal?" ≥ 4/5 for each of
  six test animals (ginger tabby & white, calico, solid black, tuxedo, beagle,
  golden retriever).
- Silhouette test: render at 64px greyscale. Species still unmistakable. This is
  the test the old rig fails, and it catches proportion errors that texture
  detail hides.
- Per-parameter sheet: change one appearance number, render before and after.
  Every number must visibly do the thing its name claims.

**Sharpness**
- Zero visible aliasing at DPR 2 with render-scale 1.0. Fur alpha resolved — no
  dither crawl when the camera is still.
- Zoom to 1400px: no polygonal silhouette edges, no stair-step on the ear rim.

**Motion**
- Sustained 60fps with p95 frame time under 8ms at 512px on M1 integrated
  graphics; the perf harness fails CI above that.
- Foot slide under 2px/frame during walk and trot, measured on the contact joint
  in world space.
- No pops: joint angular velocity continuous across every clip transition —
  measured, not eyeballed.
- Idle stillness preserved. The weighting in `stage.js` (sit 26, sleep 7…) is a
  real finding — a pet that constantly performs is exhausting to have on screen.
  Port the weights, don't re-derive them.

**Battery and citizenship** (the overlay runs all day)
- Under 3% CPU and 8% GPU when idle at LOD 0; drop to 30fps and cut shells when
  the app is unfocused; pause entirely on battery saver.

---

## 4. Phases

Each phase has a deliverable and a gate. Do not start the next before the gate
passes — this project's whole history says visual work compounds errors when it
goes unverified.

### Phase 0 — foundation (1 day)

- `git init`. The repo is not under version control right now, which is the
  single riskiest fact about it. Commit the current 2D engine first so Plan B
  stays reachable.
- Cursor project rules (§5). The art invariants in `pet-rig-lessons` become rules
  the agent reads on every request — they cost you real time to find and an agent
  will re-make every one of them.
- **Screenshot harness before any art code.** `tools/shot3d.js`: boot the scene
  headless, render N poses or turntable frames to PNG, tile into a labelled
  contact sheet. Cursor's agent reads PNGs in chat; without this it is judging
  art by reading shader source, which does not work.
- Perf harness `tools/perf3d.js`: 600 frames, report p50/p95/p99 and draw calls,
  exit non-zero over budget.
- `ASSETS.md` (provenance and licence per file) and the `.pet.json` v2 schema
  stub.

**Gate:** `node tools/shot3d.js` produces a sheet of a placeholder sphere from a
cold checkout, on one command.

Headless GL note: Playwright's bundled Chromium needs `--use-angle=swiftshader`
(or a real GPU via `headless: "new"`) or you get a black frame and a wasted
afternoon. Prove the harness on a lit sphere first.

### Phase 1 — asset pipeline (1 week, in parallel with the licence decision)

- `art/src/*.blend` (source, Git LFS or a release asset) → `art/build/*.glb`
  (checked-in build output, so the web app still has no build step).
- `art/scripts/export.py`, run by headless Blender: decimate to target, validate
  UVs, bake morph targets, export glTF with Draco and KTX2.
- Two species, separately. **A dog is not a cat with different ears** — you
  proved that twice, in two languages. In 3D that becomes structural: separate
  mesh, separate skeleton proportions, separate groom. Do not parameterise one
  into the other.
- Skeleton: ~45 joints. Spine 5, neck 3, tail 6–9, per-leg 4 plus a toe, jaw,
  two per ear, two eyes. Name them once, in a schema file, and never rename.
- Morph targets — this is where the analyzer's numbers land: skullWidth,
  muzzleLength, muzzleDepth, earSet, earSize, earFold, neckThickness,
  chestDepth, waistTuck, backLength, toplineSlope, legLength, hockAngle,
  pawSize, tailLength, tailFluff, bodyMass, cheekFluff.
- Validation script: every morph at 0 and 1 and both extremes combined, no
  self-intersection, no inverted normals.

**Gate:** contact sheet of both species × 8 morph extremes. Nothing looks broken,
and a beagle and a labrador are visibly different animals built from one mesh.

### Phase 2 — render core (4 days)

- Scene, camera on a slightly long lens (50–65mm equivalent; wide lenses make
  animals cartoonish), one key plus a fill plus a rim, and a small baked IBL — a
  64px HDR cube is enough and costs nothing.
- A contact shadow that grounds the animal. The current 2D version has a ground
  shadow flag for the same reason; keep it, it does more for realism than a
  polygon count increase.
- Colour management end to end. Linear working space, AgX or ACES out. The
  `SHADOW_FLOOR` finding in `coat.js` becomes a tonemap shoulder rather than a
  channel-wise clamp — keep the behaviour (a near-black cat must not read as a
  hole in a dark page) and delete the hack.
- Sizing: `renderer.setPixelRatio(min(devicePixelRatio, 2))` plus a `renderScale`
  supersample. Resize observer, no fixed grid anywhere.
- Transparent-background path for the desktop overlay, premultiplied correctly.
  **Canvas wants straight alpha, CoreGraphics wants premultiplied** — that lesson
  survives the replatform verbatim, and getting it backwards is a dark halo.

**Gate:** a lit, shadowed, correctly-tonemapped mesh at DPR 2 with no aliasing;
perf harness green.

### Phase 3 — coat material (1 week)

The most valuable idea in the existing engine is that markings live in body
coordinates, not screen space. Keep it; move it into UV space.

- Bake a body-coordinate atlas into the UVs: along-body `u`, around-body `v`,
  plus region IDs (head, muzzle, chest, saddle, socks, tail) as a mask texture.
  This is `Part` and the region map, promoted to a texture.
- A shader graph driven by the appearance numbers: base plus accent plus white,
  tabby stripes from body-space noise, calico patch fields, mackerel versus
  classic, blaze/mask/saddle/socks as region gradients, tail banding along `u`.
- Port the analyzer's hard-won colour rules into the *material*, not only the
  measurement: fur gamut (near-neutral, or warm 12°–60°) as a clamp on incoming
  colour; muted irises; a blaze measured as a centre band against the flanks,
  never as total white fraction.
- Two-layer coat: undercoat colour beneath guard-hair colour. That difference is
  a large part of why real fur doesn't look painted.

**Gate:** six test animals rendered beside their reference photos in one sheet.
Colour reads warm where the animal is warm. Same discipline as
`tools/test-analyzer.js` — photo, cutout, result, side by side, so a bad frame
can be blamed on the right stage.

### Phase 4 — fur (1.5 weeks, the highest-risk phase)

- Shells: 8–16 extruded copies along the normals, alpha ramping outward, with a
  fur-direction map combed in Blender and baked to a tangent texture. Fins on
  the silhouette edges, where shells alone read as banding.
- Hair cards for the ruff, ear tufts, tail plume and the fringe on a long-haired
  cat. The silhouette is where realism is won or lost — a perfect body shader
  with a hard vector edge still reads as vinyl.
- Anisotropic strand shading (Kajiya–Kay is enough; Marschner if WebGPU compute
  is available) with a secondary specular and a transmission term so backlit
  ears glow. Ear glow is disproportionately convincing.
- LOD ladder: shells 16/12/8/4 × cards on or off, chosen from on-screen size and
  focus state. Same instinct as the existing `quality` parameter, now graduated.
- Fur drag: offset shell extrusion by the joint's recent velocity. One line of
  motion history per bone, and it removes most of the rubber-toy feel.

Reference implementations to read, not copy:
[piellardj/fur-threejs](https://github.com/piellardj/fur-threejs),
[Three-Hair card rendering](https://github.com/AEspinosaDev/Three-Hair),
[a real-time fur write-up](https://www.sci.utah.edu/~thiago/fur/fur.html).

**Gate:** the 64px silhouette test passes; blind-test likeness ≥ 4/5 on two
animals; p95 still under budget at LOD 1.

### Phase 5 — face and eyes (5 days)

Faces carry likeness disproportionately, and every mistake available here is one
you have already made once in 2D.

- Eyes as their own material: cornea with refraction and a parallax iris, wet
  specular, muted iris saturation (saturated irises read as neon, and that holds
  at any resolution), pupil shape per species and light level.
- Blink with a floor. `0.42 + 0.58 * open` exists because linear eye-height
  scaling collapses squints into dark smudges. Port the curve.
- Both eyes share a phase. One eye open and one shut was a real reported bug; in
  3D it comes back as two independently-driven blend shapes. Drive both from one
  value.
- The profile view keeps a smaller, set-back far eye. A strict side view drawing
  only the near eye was read as the far eye being shut while walking.
- Whiskers: cards or thin ribbons, twelve per side, with drag. Missing whiskers
  is the fastest route to a cat that looks wrong for reasons nobody can name.
- Wet nose specular, and no seam line around the muzzle — a `['muzzle','head']`
  seam drew a line no cat has. In 3D that becomes a normal-map or UV seam. Check
  it explicitly.

**Gate:** head close-up sheet — front, three-quarter, profile — per species.

### Phase 6 — motion (1.5 weeks)

- Clip library, matching today's names so the behaviour layer ports cleanly:
  sit, blink, slowBlink, lookAround, walk, trot, groom, loaf, sleep, stretch,
  purr, knead, startle, pounce, wake, speak.
- Locomotion as a blend tree over speed, with foot IK onto the ground plane and
  the stride phase locked to actual translation. Foot slide is the single most
  common realism break in web 3D animals.
- Inertialized transitions (a five-frame blend on rotation velocity) rather than
  crossfades. That is the difference between "smooth" and "smooth except at the
  joins."
- Procedural layers stacked over the clips: breathing, weight shift, ear flicks,
  a verlet tail chain, head look-at with neck limits so cursor tracking doesn't
  snap the neck.
- Port `stage.js` behaviour verbatim in spirit: idle weighting, edge turnaround
  (`atEdge`, `walkTo` clamping, abandoning an unreachable goal), click reactions,
  speech lines.
- **Tail sanity check on every new view.** The side-view tail was invisible for
  months, hidden inside the body capsule with a sign error, on every walking cat
  and dog. Rig it, render walk and trot, and *look for a tail* — make it an item
  in this phase's gate, because you already know that failure survives code
  review.

**Gate:** turntable plus every clip as animated contact sheets; foot-slide and
velocity-continuity metrics under threshold.

### Phase 7 — analyzer v2 (1 week)

Keep the whole pipeline. It works, and it is the privacy story: `yolos-tiny`
detect → five spread points → `slimsam-77-uniform` → candidate scored by box fill
minus spill (never SAM's own confidence, which was 0.97 on a fridge), species by
vote across photos.

The new work is only about feeding the 3D rig:

- Measure the morph inputs the mesh now needs: leg-length ratio, chest depth,
  waist tuck, muzzle length-to-width ratio, ear set and fold, tail length and
  fluff, topline slope, body mass. Each from the shot that can *see* it —
  `readFromShots` already encodes exactly this principle, so extend its table.
- Keep guided capture (`analyzer/shots.js`): four named slots, the one-video
  shortcut, "which one is looking at you?" **Asking beats classifying** — shape
  scoring put a photo of a cat's back in the face slot at 0.92 confidence.
- Keep click-the-eye and drag-the-box. Three attempts at automatic iris detection
  produced three confident failures; ginger cheek fur measures 0.66–0.83
  saturation.
- Keep `chromaClusters` (divide brightness out, 75th-percentile brightness per
  cluster, weight × (0.15 + sat)^1.5), the fur gamut gate, the Otsu-plus-median
  white threshold, and EXIF baking. Every one of those is a bug already paid for.
- Optional, later: a fourth pass estimating pose from the side shot to seed the
  morphs better. Not needed for v1.

**Gate:** `tools/vision-sheet.js` extended to four columns — photo, mask, morph
parameters, 3D render — run over your own Momo and Belle footage.

### Phase 8 — studio UI (1 week)

- The guided capture flow as it is, with the slot illustrations regenerated from
  the *3D* renderer in the exact viewpoint being asked for. Rounded-rectangle
  tiles, fitted rather than cropped, framed by the sprite's opaque bounds, and
  never an animal cropped in half. All three rules survive the replatform.
- A live 3D preview that updates as sliders move. The correction step is the
  design, not a fallback, and it gets far better when the preview is instant.
- Sliders now include the morphs. Group them: build, head, ears, tail, coat.
- `.pet.json` v2 export, plus a v1 → v2 migration so anything already saved still
  opens. Version the format and keep the `format` field.

**Gate:** a stranger's phone photos to a recognisable animal in under three
minutes, walked through by someone who has not seen the app.

### Phase 9 — desktop overlay (1 week)

- Electron, transparent always-on-top window; `LSUIElement` is already set. Add
  click-through everywhere except the animal's own alpha, multi-monitor handling,
  and per-display DPR.
- Aggressive LOD when unfocused, 30fps when not hovered, pause on battery saver.
  An always-running 3D overlay that costs 20% of a battery gets uninstalled no
  matter how good it looks.
- Keep the LaunchAgent for open-at-login (deliberately not
  `setLoginItemSettings`), and add the Windows equivalent via Task Scheduler.
- A `.pet` file association, so the handover is a double-click.

**Gate:** eight hours on battery with acceptable drain; sits over a full-screen
app; survives sleep/wake and a display reconnection.

### Phase 10 — iOS (optional, 1 week)

`~/Brainstorm/StillAround/` is the trailing implementation. The cheapest path once
the glTF exists is to convert to USDZ and drive it in SceneKit or RealityKit,
keeping `PetAppearance` as the same numbers. The floating-over-other-apps
constraint is unchanged: Picture in Picture via `AVSampleBufferDisplayLayer` is
the only sanctioned surface, it needs `UIBackgroundModes: audio` in a real
`Info.plist`, and it **cannot be tested in the Simulator**. Device-deploy
specifics (team `UMD9S65GU8`, the phone must be unlocked, the `--autofloat`
launch arg) are already recorded in memory.

### Phase 11 — ship (1 week)

- Fill in `web/config.js`: download URLs, support link, analytics domain.
- Signing. An Apple Developer certificate and a Windows code-signing
  certificate, set as `CSC_LINK` / `CSC_KEY_PASSWORD` repo secrets. Unsigned
  installers lose most would-be users at the SmartScreen dialog; for a project
  whose only goal is to be popular, this is not optional polish.
- CI: the existing `v*`-tag workflow already builds each installer on its own
  runner (electron-builder cannot cross-compile a DMG or an NSIS installer). Add
  the perf and contact-sheet harnesses as PR checks.
- Asset size budget: meshes plus textures plus the ~20MB of vision models. Load
  the models only when someone starts the studio; the landing page stays under
  2MB.
- Then promotion — cat and dog community groups, the relevant subreddits, Hacker
  News on the privacy angle ("your photos never leave your browser" is the actual
  story), and the memorial angle handled gently.

---

## 5. Doing this in Cursor, specifically

### Project rules

Create `.cursor/rules/`, all `alwaysApply: true`:

- **`art-invariants.mdc`** — paste `pet-rig-lessons.md` nearly verbatim. Every
  rule in it is a mistake an agent will cheerfully re-make: shading from
  per-shape edges, k-means on RGB, auto-detecting iris colour, a dog as a
  parameterised cat, straight versus premultiplied alpha, EXIF orientation.
- **`verify-by-looking.mdc`** — "Any change to `engine3/`, a shader, a groom or a
  rig must end with rendering a contact sheet and inspecting it. Never report an
  art change as done on the basis of code reading or a passing unit test."
- **`no-generated-art.mdc`** — "No image generation, no neural texture synthesis,
  no stock art, no sprite sheets. Every pixel comes from the renderer."
- **`privacy.mdc`** — "No network calls carrying user data. No server. Photos
  never leave the device. Model weights from a CDN are the only remote fetch."
- **`perf.mdc`** — "p95 frame-time budget is 8ms at 512px. Run `tools/perf3d.js`
  after any render-path change."

### The one Cursor-specific thing that matters most

Cursor's agent cannot see. It will confidently declare fur "now looks realistic"
after editing a shader it never rendered. So the harness is not tooling, it is
the agent's eyes, and it belongs in Phase 0, not Phase 4. Every art task ends
with: run the sheet, attach the PNG, look at it yourself. Your project history
already says this in the 2D idiom; it is twice as true with an agent driving.

### Model and mode per phase

- **Plan mode with a thinking model** for shader architecture, the
  morph-to-parameter mapping, the motion state machine, and anything in Phase 4.
- **Agent mode with a fast model** for the Blender export script, harness
  plumbing, UI wiring, the v1 → v2 migration, and porting `stage.js` behaviour.
- **Ask mode** for reading the existing engine before replacing a piece of it.
  The 2D engine is small (6.4k lines) and dense with earned decisions; have the
  agent summarise a file before rewriting its 3D equivalent.

### Context hygiene

- One phase per branch, one Cursor notepad per phase holding its gate criteria.
  Paste the gate into the prompt — agents optimise for whatever acceptance test
  is in front of them.
- Attach files explicitly (`@art/scripts/export.py @engine3/coat.glsl`) rather
  than letting it search. There will be two engines during the transition and
  the agent will read the wrong one.
- Keep this file attached to every phase-opening prompt.

### Paste-ready phase prompts

**Phase 0**

> Read `PLAN-3D.md` phase 0. Initialise git and commit the current state
> untouched as "2D engine, pre-replatform". Then build `tools/shot3d.js`: a
> Playwright-driven headless three.js harness that loads a scene module, renders
> a list of camera angles and animation frames at DPR 2, and tiles them into one
> labelled PNG contact sheet. Prove it on a lit sphere with a checker texture.
> Chromium needs `--use-angle=swiftshader` or you will get black frames. Then
> `tools/perf3d.js`: 600 frames, print p50/p95/p99 frame time and draw calls,
> exit 1 over an 8ms p95 budget. Do not write any pet art code in this phase.
> Finish by running both and showing me the sheet.

**Phase 3**

> Read `PLAN-3D.md` phases 1–3 and `.cursor/rules/art-invariants.mdc`. Then read
> `engine/coat.js` and `engine/painter.js` and summarise how markings are bound
> to body coordinates before changing anything. Implement `engine3/coat/` as a
> three.js material whose inputs are exactly the appearance object, with
> body-coordinate UVs and a region-ID mask replacing the region map. Enforce the
> fur gamut and iris saturation clamps in the material. Render the six test
> animals from `tools/sheet.js` through the new material into one sheet, beside
> the 2D render of the same numbers, and show me both.

**Phase 4**

> Read phase 4. Implement shell-and-fin fur in `engine3/fur/` with a combed
> direction map, an outward alpha ramp, Kajiya–Kay anisotropic specular, a
> transmission term for backlit ears, and shell-count LOD 16/12/8/4. Add
> velocity-based shell offset for fur drag. After each substantive change run
> `node tools/shot3d.js --sheet fur` and `node tools/perf3d.js` and show me both
> outputs. Also render the 64px greyscale silhouette test; if the species is not
> unmistakable, the geometry is wrong and no shader work will fix it — tell me
> that rather than tuning around it.

### Tooling to wire up in Cursor

- Blender via a shell task, not a GUI: `npm run art:export` → headless Blender.
- Browser tools, so the agent can drive the studio flow end to end (upload a
  fixture video, walk the four slots, export a `.pet`) instead of asking you to
  click.
- Nothing else. Extra MCP servers cost context, and this project's bottleneck is
  looking at pictures, not tool breadth.

---

## 6. Risks, honestly ranked

| risk | likelihood | mitigation |
|---|---|---|
| asset licence forbids shipping inside a public MIT repo | high | resolve in week 1 (§2); prefer commission-with-buyout or CC0 |
| fur too expensive for an always-on overlay | medium-high | LOD ladder designed in from Phase 4; overlay defaults to LOD 2 with cards off; measure on M1 integrated, not your best machine |
| WebGPU renderer instability | medium | WebGL2 fallback tested every phase, never "later" |
| photorealism raises the likeness bar, so near-misses feel worse | medium | it's a memorial app: state the honest ceiling in onboarding copy and keep the correction sliders prominent |
| 3D scope swallows the project and nothing ships | medium | Plan B stays on a branch; every phase gate is independently shippable |
| morph range can't cover breed variety | medium | six test animals across the range from Phase 1, not Phase 8 |
| Momo and Belle land last | low, but it matters | make them two of the six test animals from Phase 1 |

**Timeline:** 10–14 weeks of solo evenings with Cursor doing the mechanical work,
gated on when meshes arrive. Phases 0–2 take a week and derisk the rest; if the
Phase 4 gate fails twice, that is the signal to fall back to Plan B rather than
keep tuning.

---

## 7. What not to touch

The analyzer, the shot list, the privacy promise, the `.pet` file, the harness
culture, the idle behaviour weighting, and the README's honesty. Those are the
parts of this project that are genuinely good, and the replatform is only about
the renderer. The findings in `pet-rig-lessons` and the README were each paid for
once — carry them forward rather than rediscovering them in GLSL.
