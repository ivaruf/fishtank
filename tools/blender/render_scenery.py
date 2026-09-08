"""Render the scenery review sheet, docs/scenery-preview.png.

    blender --background --factory-startup --python tools/blender/render_scenery.py

Run it after both build scripts: it loads the saved .blend sources rather than
rebuilding anything, so the sheet always shows exactly what was exported. It is
documentation only - nothing here ships, and the game never reads it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scenery_common import SCENERY, studio

studio(SCENERY)
