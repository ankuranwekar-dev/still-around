# Still Around

A small animated version of your cat or dog that lives on your desktop while you
work. Give it a few photos, it measures their colours and markings, and you get
your animal — pottering about, dozing off, occasionally asking to be fed.

Built in memory of two cats: Momo, a ginger tabby, and Belle, a calico.

**Free, no account, and nothing is uploaded.** The website is static files; the
measuring happens in the visitor's own browser. There is no server to send a
photograph to.

---

## How it works

Every frame is drawn from about thirty numbers. There are no sprite sheets, no
stock art, and no image generator anywhere in this project.

```
pose (numbers) → shapes → region map → coat paints it → pixels
```

- **`engine/`** — the art. `rig.js` is anatomy, `coat.js` is colour, `painter.js`
  turns a region map into pixels, `poses.js` is the animation library, `stage.js`
  makes a pet that wanders about and reacts to being clicked.
- **`analyzer/`** — reading a real animal out of photographs. `vision.js` runs
  the models, `segment.js` is the no-model fallback, `analyze.js` is the colour
  measurement, `frames.js` pulls the sharpest frames out of a video.
- **`web/`** — the website: the studio, the downloads, and a live pair of cats.
- **`desktop/`** — the Electron app, macOS and Windows.
- **`tools/`** — offline harnesses. These are how the art was actually tuned.

The engine and analyzer are imported *unmodified* by both the website and the
desktop app. A pet built in a browser looks identical on the desktop because it
is the same code drawing it.

### The pet file

The handover between website and desktop app is a few hundred bytes of JSON:

```json
{ "format": "still-around/pet", "version": 1, "name": "Momo",
  "appearance": { "species": "cat", "base": { "r": 0.79, "g": 0.53, "b": 0.29 }, … } }
```

Colours, how much white, how striped. Not your photographs. That is the entire
sync mechanism — no accounts, no server, and you can email it to yourself.

---

## Running it

```bash
npm install
npm start            # the desktop app
npm run web          # the website at http://localhost:8731/web/
```

`npm run web` uses `tools/serve.js` rather than `python -m http.server` for one
reason: it sends `Cache-Control: no-store`. Without that a browser keeps serving ES
modules from its own cache across reloads, so edits to `engine/*.js` silently do
nothing while the page looks reloaded — an afternoon went into chasing a "bug" that
was a stale module.

Useful harnesses:

```bash
npm run sheet                          # contact sheet of test cats and dogs
node tools/vision-sheet.js <dir>        # photo | classical | vision | pet, side by side
node tools/test-analyzer.js <dir>       # the same without the models, for comparison
node tools/make-icons.js                # app icons, rendered from the engine
node tools/web-shot.js out.png          # the website itself, full page
```

`ONLY=beagle,lab POSES=sit,walk node tools/sheet.js out.png` narrows the sheet
while iterating on one animal.

### Building the installers

```bash
npm run dist:mac     # .dmg   (must run on macOS)
npm run dist:win     # .exe   (must run on Windows)
```

electron-builder cannot cross-compile a DMG or an NSIS installer, so
`.github/workflows/release.yml` builds each on its own runner. Push a `v*` tag
and it produces a draft release with both.

**macOS is signed and notarized**; `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are repository secrets that
electron-builder reads directly from the environment — nothing in
`package.json` references them. One thing cost a build finding out:
`CSC_IDENTITY_AUTO_DISCOVERY` must not be set to `false`, even alongside a real
`CSC_LINK` — that combination makes electron-builder skip signing entirely
(electron-userland/electron-builder#7515).

**Windows is not code-signed.** That needs a certificate from a different kind
of CA (DigiCert, Sectigo, etc.), not Apple's, and isn't set up — SmartScreen
still warns on first run there. "More info" → "Run anyway" gets past it.

### Before it goes live

Fill in `web/config.js`: the download URLs, a support link, and an analytics
domain if you want one. Everything there is public by design — the site is static
and has no secrets to keep.

---

## The vision models

Finding the animal is the step everything else depends on: a cat measured from a
tiled floor comes out grey, and no amount of good colour maths recovers from that.
Two models run locally, in the browser, on the visitor's own machine.

| | model | why | size |
|---|---|---|---|
| find | `Xenova/yolos-tiny` | COCO detector; cat and dog are classes, so it also settles the species and can say "there's no pet in this photo" | ~7 MB q8 |
| cut | `Xenova/slimsam-77-uniform` | Segment Anything compressed 637M → 5.5M params, prompted rather than guessing at the most salient object | 13.8 MB q8 |

fp16 on WebGPU, int8 otherwise, fetched once and cached. Weights come from a CDN;
the photographs do not go anywhere.

`analyzer/vision.js` loads the installed `@huggingface/transformers` package if
there is one and falls back to a CDN otherwise, which is what lets
`tools/vision-sheet.js` run the *exact same code* offline under Node — the
before/after sheet in that tool is how these decisions were actually judged. Two
runtime traps live in that loader: `env.useBrowserCache` throws under Node, and the
backend is called `wasm` in a browser but only `cpu`/`coreml`/`webgpu` are accepted
by Node.

Measured on the project's own test footage, the classical cutout returned grey or
blue-grey coat colours (`#b2b1c4`, `#b8b1ae`, `#a29a91`) because it was cutting out
cupboards, floor tiles and blankets. With the models the same photographs give
`#a57e51`, `#9e8461`, `#a18060` — warm, which is what the animals are — and mask
spill fell from 0.3–8x the detector box to 0.01–0.05x.

**Why prompted segmentation rather than background removal.** BiRefNet and
RMBG-2.0 produce better fur edges than anything else available, and BiRefNet is
MIT-licensed — but the smallest usable ONNX build is 115 MB (fp16), RMBG-1.4's
licence is non-commercial, and neither has any idea whether it is looking at an
animal or a houseplant. A detector plus a prompted segmenter is a fifth of the
size, knows what it found, and degrades into something a person can fix with one
click.

Three things that were not obvious:

- **This export of SlimSAM accepts `input_boxes` and then ignores them.** Measured
  against the detector's box, every candidate mask spilled 0.3x to 8x the box
  area, because only the point prompt was doing any work. The box is still the
  most useful thing in the pipeline — as somewhere to put points, and as a
  yardstick for judging the output — just not as a prompt.
- **One point in the middle of the box is not enough.** The centre of a bounding
  box is very often not the animal: for a cat sitting on a fridge, the centre is
  fridge, and SAM segmented the fridge. Five points spread through the box fixed
  it.
- **SAM's own confidence picks the wrong mask.** It returns three candidates and
  ranks them, and for that same fridge photo the most confident at 0.97 *was* the
  fridge. Scoring candidates by how much of the detector's box they fill minus how
  far they spill outside it picks correctly on every test photograph.

Species comes from a vote across all the photos rather than the last one, because
a dark cat photographed from behind is regularly called a dog.

## The shot list

The interface asks for four named viewpoints rather than accepting a pile of
photographs and guessing. That is not a photography lesson dressed up as a form —
it falls out of the measurements. Every parameter can only be read from a
photograph that can *see* the thing it describes:

| shot | what only it can see |
|---|---|
| **Looking at you** | eye colour, nose, how far colour reaches down the face, a white blaze, dark eye rings |
| **From the side** | coat colours, saddle, stripes, patches, build, size |
| **Sitting, facing you** | white chest, white front paws |
| **Their tail** | tail rings, tail shape |

Two things follow. First, **averaging every measurement over every photo destroys
information rather than adding it** — a face close-up has no opinion about a white
chest, and letting it vote on one is noise. `readFromShots` reads each parameter
from the shot that can see it, and anything nobody could see keeps its default,
which leaves the slider where the owner can find it. Second, **asking is the
cheapest and most accurate classifier available**: when someone fills the slot
labelled "looking at you", the shot type is known exactly, for nothing.

That second point is not a shortcut, it is a necessity. Scoring the project's own
footage by shape put a photograph of a cat's *back* into the face slot with 0.92
confidence, because at close range a back is exactly what a face looks like to a
geometry test: a big, compact, roughly square blob. CLIP could tell them apart,
but the smallest usable build is 126 MB against 20 MB for everything else here.

**One video is the easiest path and also the best input.** A ten-second walk
around the animal contains every angle in the same light, so frames can be scored
*against each other* rather than against absolute thresholds. Side, sitting and
tail are filled automatically from a video; the face is offered as a handful of
candidate crops with "which one is looking at you?", because that is the one shape
cannot judge. Tapping the answer doubles as the moment to tap an eye. Measured
end to end on a 46 MB clip: 14 frames extracted, detected, segmented and sorted in
38 seconds.

Candidates the segmenter was unsure of are dropped before the question is asked —
in testing two of six were a cushion and a blanket that SAM had grabbed instead of
the cat, and offering those makes an easy question hard.

## The illustrations

The empty slots are drawn by this project's own renderer, posed in exactly the
viewpoint being asked for, looping gently at six frames a second. `SLOT_ART` in
`analyzer/shots.js` says which clip and framing each slot uses.

The first attempt was hand-written SVG — a circle, two triangles, two dots for eyes
— and it read as a mask rather than a cat; against the dark palette it was, in the
words of the person it was built for, like something from a Halloween party. There
was never any need for it: the renderer already existed, and using it means the
picture beside "from the side" *is* a pet seen from the side, drawn by the code that
will draw theirs.

Three things that had to be got right, each found by looking at the result:

- **A circle cannot frame a wide subject.** A cat seen side-on is half again as wide
  as it is tall, and a circular tile clipped its ears and feet into the corners.
  The tile is a rounded rectangle, and every illustration is *fitted* inside it —
  never filled and cropped.
- **Frame by the sprite's own opaque bounds.** The rig leaves different amounts of
  empty canvas per pose, so fixed fractional crops left every animal floating high
  in its tile.
- **Never crop an animal in half.** An attempt to make the tail slot obvious by
  cropping to the back half produced a headless torso — grotesque on a page about
  someone's dead pet. The animal stays whole and the tail does the talking: that
  slot trots with a deliberately fluffy, banded tail, and the illustration pet's
  striping is turned down because at 136 pixels a striped tail vanishes into a
  striped body.

## Things learned the hard way

Recorded because each one cost real time and none is obvious from the code.

**k-means over RGB clusters a coat by brightness, not colour.** Within one animal
light varies more than pigment does, so every test clip returned three clusters
at hue ~30° with luminance 0.32 / 0.44 / 0.58 — picking one was a statement about
the lighting, not the cat. `chromaClusters` divides brightness out first and takes
each cluster's brightness from the 75th percentile of its own pixels, because most
fur in a photograph is partly shaded and what an owner recognises is the coat in
good light. This is what turned muddy grey-brown output into the warm ginger the
photographs actually show.

**Otsu is not enough to find white on a close-up.** It looks for a bright half
and a dark half, and a face filling the frame in good light has no dark half, so
it splits inside the fur — reporting a tabby face as 99% white. The white
threshold now also has to sit above the animal's own median luminance: white means
brighter than this animal generally is, not merely bright.

**A blaze is not "white".** It is white up the middle with colour either side.
Taking the whole white fraction gave a solid white cat a blaze of 1.0; measuring
the centre band against the flanks reads the actual stripe.

**In the side view the tail was invisible, and had been all along.** The chain
started inside the body capsule so the body painted over it, and because the chain
runs with `dir = -1` a *positive* `tailBase` swings the tail downward into the back
legs. Every walking cat and dog had a hidden tail. The origin moved to the top of
the rump and the sign is flipped in the view, so poses can keep saying "more
tailBase means more lift".

**Fur has a gamut.** Cats and dogs are near-neutral or warm between about 12° and
60°. Saturated greens are floors, tiles and cardboard boxes; saturated pure reds
are pet beds and cushions. One clip rendered a bright green cat, and another
reported a red bed as the coat colour, before those were rejected.

**Do not guess iris colour.** Three attempts in the native version each produced
confident nonsense: a ginger cat's cheek fur measures 0.66–0.83 saturation, which
beats most tests you would reach for, and in casual photographs the animal is
usually squinting or the eye joint has landed on an ear. The web version asks the
person to click their pet's eye. One gesture, exact answer.

**A dog is not a cat with different ears.** The first attempt parameterised the
cat — floppy ears, longer snout, bigger grid — and every dog still read as a cat.
What makes a dog is the skeleton: legs that stand it clear of the ground, a deep
chest over a tucked waist, a topline sloping from shoulder to hip, and hocked
back legs. Dogs have their own three views.

**Shading must key off the whole silhouette, not each shape's edge.** Per-shape
distance puts a dark rim wherever a leg meets the body and the result looks like
a bundle of inflated sausages. `silhouetteDepth` measures depth into the animal.

**Canvas wants straight alpha, CoreGraphics wants premultiplied.** Getting it
backwards shows up as a dark halo around the whole animal.

**Verify by looking.** Every real improvement here came from rendering a sheet and
looking at it. `tools/` exists for that reason, and `tools/test-analyzer.js` puts
the photo, the cutout and the resulting pet side by side so a bad result can be
blamed on the right stage.

---

## Licence

MIT. For Momo and Belle.
