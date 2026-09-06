# Fish detail upgrades — handoff

Updated 2026-09-06. The roster contains 14 species and all of them now have authored four-tier upgrades. Work in small batches to conserve session usage. Do not rebuild or redesign all fish at once.

## Completed

- [x] Clownfish: rounded/scalloped fins, gills and lips, scale arcs, iris detail, animated pectorals.
- [x] Blue tang: swept sails, gill covers, scales, bilateral fin rays, animated flippers.
- [x] Pufferfish: muzzle and gills, belly ridges, tapered spines, fine freckles, animated flippers.
- [x] Goldfish: split curved fantail, scalloped dorsal/anal membranes, fin rays, gill plates, lips, scale arcs, animated pectorals and pelvics.
- [x] Betta: ruffled halfmoon caudal and veil fins, layered rays, sheen scale arcs, gill beard, independently fluttering dorsal/anal/pectorals.
- [x] Angelfish: thin curved sails with fine rays, forked caudal with filaments, sculpted gills and snout, flank scales between the bars, swaying pelvic streamers.
- [x] Butterflyfish: tapered forceps snout and lips, eyespot sunk into the skin, scalloped dorsal/anal with rays, gill crease, flank scales, animated pectorals.
- [x] Wrasse: conical fusiform body, flush cheek bands, forked caudal, low dorsal with trailing filaments, fine scales, fluttering pectorals.
- [x] Royal gramma: interlocking purple/gold seam, gill and eye stripe in the skin, split scalloped dorsal, two-tone scales, iris filaments.
- [x] Triggerfish: pearl spots flattened into the skin, sculpted lips and gill slit, golden saddle, tapered trigger spine and latch, caudal rays.
- [x] Lionfish: curved tapered dorsal and anal spines with sagging webs, radiating pectoral fans on their own slow hinges, pinstriped band edges, brow tassels, webbed pelvics.
- [x] Seahorse: tapered tubular snout, curling coronet, bony ring plates with corner spines and running ridges, plated prehensile spiral, fluttering dorsal fan and beating ear fins.
- [x] Manta ray: cambered wings with upswept tips on independent flap hinges, raised body pod, curled cephalic lobes, ventral gill slits, mottled spots and a tapered whip tail.
- [x] Shark: blunt snout with a wrapping grin and teeth, five curved gill slits, swept fins on hinges, asymmetric notched caudal on a tapered peduncle, lateral line and denticles.

Each has `-low.glb`, `.glb`, `-high.glb`, `-hd.glb`, matching editable `.blend` files, comparison PNGs, and a menu thumbnail. Extra tessellation alone does not count as an upgrade.

## Remaining species

All fourteen species are done. No species remain on the basic standard/HD-only path.

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
2. Author species-specific layers using `tools/blender/clownfish_detail.py`, `reef_detail.py` or `patterned_detail.py` as references. Helpers and shared export settings are in `create_fish.py`.
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
