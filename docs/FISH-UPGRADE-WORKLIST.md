# Fish detail upgrades — handoff

Updated 2026-09-06. The roster contains 14 species. Three have authored four-tier upgrades; eleven remain. Work in small batches to conserve session usage. Do not rebuild or redesign all fish at once.

## Completed

- [x] Clownfish: rounded/scalloped fins, gills and lips, scale arcs, iris detail, animated pectorals.
- [x] Blue tang: swept sails, gill covers, scales, bilateral fin rays, animated flippers.
- [x] Pufferfish: muzzle and gills, belly ridges, tapered spines, fine freckles, animated flippers.

Each has `-low.glb`, `.glb`, `-high.glb`, `-hd.glb`, matching editable `.blend` files, comparison PNGs, and a menu thumbnail. Existing standard and HD exports for the species below are still basic models; extra tessellation alone does not count as an upgrade.

## Remaining species, suggested order

| Done | Species       | Visible upgrade to pursue                                                                                                           |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [ ]  | Goldfish      | Curved split fantail, scalloped membranes, fin rays, gill plates and subtle scales; flowing fin motion.                             |
| [ ]  | Betta         | Wavy veil edges, layered rays, richer body sheen, and independently fluttering large fins.                                          |
| [ ]  | Angelfish     | Thin curved sails, fine rays, sculpted gills, delicate pelvic streamers and gentle fin movement.                                    |
| [ ]  | Butterflyfish | Refined snout, flatter integrated eyespot, curved dorsal/anal edges, fine scales and fin rays.                                      |
| [ ]  | Wrasse        | Better tapered silhouette, flush cheek markings, subtle scales, long dorsal rays and pectoral flutter.                              |
| [ ]  | Royal gramma  | Refined purple/yellow transition, gills, scalloped dorsal, fine scales and richer eyes.                                             |
| [ ]  | Triggerfish   | Flatten spots against skin, sculpt lips and gill opening, detailed trigger spine and caudal rays.                                   |
| [ ]  | Lionfish      | Curved tapered spines, thin radiating fan membranes, finer banding and slow fan movement.                                           |
| [ ]  | Seahorse      | Refined coronet and snout, segmented body plates, smooth tapered spiral and fluttering dorsal fan. Preserve upright anatomy.        |
| [ ]  | Manta ray     | Refine wing camber and cephalic lobes, underside gill slits, tail taper; add independent wing flaps (current clip only moves tail). |
| [ ]  | Shark         | Sculpt gills/mouth, swept fins and asymmetric caudal fin, subtle surface variation and body/tail flex.                              |

## Quality contract

- **Battery saver → low:** lightweight silhouette; simple materials and minimal animation.
- **Balanced → standard:** better silhouette, curved fins, clear face/gill shapes; should already look better than Low.
- **Sharper → high:** visible species-specific surface/fin detail and secondary fin motion.
- **Ultra → hd:** finer detail and highlights that hold up in close-ups, not just extra subdivisions.
- Keep the playful art style and existing gameplay scale. No changes to server rules, mass, collision or controls for visual upgrades.
- Tang/clownfish scales are geometric arcs; pufferfish uses spines. No normal maps, texture-based scales, true translucency or iridescence are implemented yet. Those are separate future material work, not completed features.
- Higher detail currently applies to every instance of that species. Distance-based LOD and a real-phone GPU benchmark remain future work.

## Implementation pattern

1. Inspect current files and git status; other tasks may have changed the repo. Preserve unrelated work.
2. Author species-specific layers using `tools/blender/clownfish_detail.py` or `reef_detail.py` as references. Helpers and shared export settings are in `create_fish.py`.
3. Add the species to the four-tier build/source-save routing in `create_fish.py`, and `DETAILED_SPECIES` in `client/js/fish.js`. `rendering.js` already maps all four quality settings. Other species intentionally stay standard/HD.
4. Keep +Z forward, +Y up in GLB, centered body root, and existing mouth/crest conventions. Seahorse's mouth sits higher; avoid universal anatomical assumptions.
5. Keep meshes/materials shared for Babylon instances. Extra animated fins should have their own named pivots, local origins, and an action merged into the exported swim clip. Export the entire fish hierarchy.
6. Export the four GLBs and Blender sources. Render low/standard/high/HD comparisons and update the standard menu thumbnail. Keep cameras/lights out of GLB exports.
7. Review Blender previews, check tier loading/animations with the focused tests, and compare in-browser when requested or needed. Do not claim physical phone performance from headless tests.
8. Update this checklist and README, then commit only intended changes.

## Commands

Blender must run outside the sandbox on this Mac; the sandboxed background process previously crashed. CPU Cycles rendering has worked. No game server is needed to generate assets.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/create_fish.py -- --models-only blue-tang pufferfish
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/create_fish.py -- --thumbnails-only blue-tang pufferfish
node --test tests/fish.test.js tests/movement.test.js
```

`--models-only` still exports models and sources but skips previews and thumbnails. Without it, the upgraded-species path renders comparisons too. Avoid starting a persistent Node server solely for asset generation.
