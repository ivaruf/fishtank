# Office and zapper detail layers

Battery Saver and Balanced keep the procedural base scene. Sharper (High) loads
`office-high.glb` and `zapper-high.glb`; Ultra loads the denser Ultra pair.

High adds a modeled monitor interface, individual keys, desk drawer and handle,
coffee rim/handle, notebook, cables, chair upholstery/arms/casters, display shelves,
books, plants, framed art and window details. Ultra adds curtains, floorboard
seams, pendant lighting, more artwork, notebook binding and paper markings.

The zapper receives a rounded shell, service panel, grille, screws, warning plate,
metal button bezel, clamps and intake fittings. Ultra adds cooling fins, ribbed
cable details, latches and a serial plate. Its existing button, status lamp,
stream and gameplay effects remain the active objects.

![The desk at Ultra, seen from inside the tank](office-ultra.jpg)

![The filter shell at Ultra, its bezel around the working red button](zapper-ultra.jpg)

Both shots are from the running local game at Ultra, and the second is the one
worth checking after any change to the offsets below: the authored bezel has to
land around the procedural button rather than beside it.

All four GLBs are authored in Blender and batched by material. No external
textures or extra real-time lights are needed. Only the selected tier is loaded;
switching down disposes the meshes and materials. Failed loads retain the base
scene. Office materials ignore underwater fog like the existing room.

Sources: `assets/blender/environment/`. Exports and triangle counts:
`client/assets/environment/`. Regenerate with:

    blender --background --factory-startup --python tools/blender/create_office_details.py

The generator uses the room's Y-up coordinates, converted to Blender Z-up.
The loader explicitly corrects Babylon's glTF X reflection before positioning
zapper details at FILTER.x/FILTER.z. Do not remove that correction without
checking the desk alignment test.

Verification: the full 50-test suite passes; `tests/environment.test.js` loads the
real GLBs on NullEngine and covers quality switching, material cleanup, stale
load rejection and desk alignment; `office-ultra.jpg` and `zapper-ultra.jpg`
above are the visual check. Performance on physical mobile devices has not been
measured.
