"""Build the seventh scenery asset: a small broken hull for a fish to swim
through.

    blender --background --factory-startup --python tools/blender/create_shipwreck.py

Its own script because it is the one asset built from beams rather than from
plant parts, and because it is the only one with an interior: the near side of
the hull is deliberately holed so the ribs, the surviving deck planks and the
snapped mast are visible from outside. Length runs along X, about 3.6 units, so
the client scales it up into a landmark rather than a prop.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
from scenery_common import clear, material, publish, stone, tube

clear()
wood=material('Aged oak',(.26,.135,.06));light=material('Worn edges',(.42,.25,.12));dark=material('Iron fittings',(.11,.15,.15));moss=material('Algae',(.16,.29,.09))

def beam(name,a,b,width,depth,mat):
    """A cube stretched and aimed from a to b, then bevelled once. The bevel is
    what makes a plank read as salvaged timber instead of a box."""
    a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cube_add(size=1,location=(a+b)/2);o=bpy.context.object;o.name=name;o.scale=(width,depth,(b-a).length);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel=o.modifiers.new('Worn edges','BEVEL');bevel.width=.018;bevel.segments=1;bpy.ops.object.modifier_apply(modifier=bevel.name)
    return o

# Length along X. Wide midship narrows to raised bow and stern.
xs=[-1.7,-1.3,-.8,-.2,.4,1,1.55,1.85];widths=[.15,.55,.73,.8,.76,.58,.3,.04]
for sign in [-1,1]:
    for row in range(4):
        for i in range(7):
            # Ragged hole in the near hull reveals ribs and the interior.
            if sign==-1 and i in [2,3,4] and row>=1:continue
            z=.22+row*.19;rise=lambda x:.13*abs(x)**1.6
            beam('Hull plank',(xs[i],sign*widths[i]*(.55+row*.14),z+rise(xs[i])),(xs[i+1],sign*widths[i+1]*(.55+row*.14),z+rise(xs[i+1])),.14,.085,wood if row%2 else light)
for i in range(1,7):
    x=xs[i];w=widths[i];tube('Exposed curved rib',[(x,-w,.94),(x,-w*.65,.42),(x,0,.16),(x,w*.65,.42),(x,w,.94)],[.055]*5,wood,8)
beam('Keel',(-1.7,0,.15),(1.85,0,.25),.16,.17,wood)
for y in [-.32,-.10,.12,.34]:beam('Surviving deck plank',(-1.23,y,.68),(-.50,y,.68),.17,.07,light)
beam('Snapped mast',(-.7,0,.65),(-.5,.08,1.85),.14,.14,wood)
beam('Fallen spar',(-.35,-.46,.35),(1.38,.48,.94),.10,.10,light)
beam('Broken mast shard',(-.51,.08,1.69),(-.48,.07,1.98),.065,.06,light)
tube('Trailing rope',[(-.55,.08,1.65),(-.15,-.10,1.05),(.42,-.26,.52),(1.1,-.5,.19)],[.022]*4,dark,6)
for x in [-1.1,-.9]:
    for sign in [-1,1]:stone('Iron fastening',(x,sign*.55,.84),(.025,.025,.025),dark)
for i in range(6):stone('Algae on hull',(-1.2+i*.2,.35,.83),(.15,.09,.05),moss)
beam('Loose timber',(-.3,-1.0,.08),(.6,-1.15,.08),.13,.06,light)
publish('little-shipwreck')
