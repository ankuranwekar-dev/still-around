# Asset provenance

Every mesh, texture, groom, and third-party binary that ships with Still Around is listed here. Read the licence before paying, and before checking a file in. Electron ships raw `.glb` inside the app bundle, the source is MIT and public, and unsigned installers are still redistribution under a strict reading.

Allowed: extended / redistribution-permitting licence, a full-buyout commission, or CC0.

| file | source | licence | notes |
|---|---|---|---|
| `engine3/mesh.js` | original | MIT (this repo) | Procedural cat (`felis`) and dog (`canis`). Not a marketplace asset. Replace with licensed `art/src/*.blend` → `art/build/*.glb` when §2 is resolved. |
| `art/build/felis.json`, `art/build/canis.json` | `art/scripts/build-meshes.js` | MIT | Bind-pose provenance stamps until a licensed glb exists. |

## Runtime libraries (not redistributed as standalone assets)

| package | licence | used for |
|---|---|---|
| `three` | MIT | realtime renderer (`engine3/`) |
| `playwright` (dev) | Apache-2.0 | headless contact-sheet and perf harnesses |
