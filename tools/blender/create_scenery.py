"""Build five of the six aquarium scenery assets: three plants, driftwood and a
weathered amphora. The sixth, the wreck, is big enough to have its own script.

    blender --background --factory-startup --python tools/blender/create_scenery.py

Each asset is one root empty named after the asset with every mesh parented to
it, saved to assets/blender/<name>.blend and exported to
client/assets/scenery/<name>.glb. Motifs, all solid geometry with plain colours:

  ribbon-grass       fourteen curved blades rising from a ring of pebbles
  broadleaf-plant    ten ridged leaves on curved petioles, pale midribs
  red-stem-plant     five stems carrying paired copper and burgundy leaves
  branching-driftwood  a branching worn trunk with roots, grain and moss
  weathered-amphora  a hollow pot with loop handles, bands and a hairline crack

Sizes are authoring units: the plants stand 1-3 units tall, which is about a
fish length and a half, and the client scales them up on placement. See
scenery_common.py for the shared helpers and the rebuild order.
"""
import sys
from pathlib import Path

# blender --python puts nothing on sys.path, so a sibling module is not
# importable until we say where it is. create_fish.py does the same.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import math
import random
from mathutils import Vector
from scenery_common import SCENERY, clear, leaf, material, mesh, publish, stone, tube


def base():
    """A ring of pebbles at the foot of a plant, hiding the join with the sand."""
    for i in range(5):
        a=i*math.tau/5;stone('Root pebble',(math.cos(a)*.2,math.sin(a)*.2,.10),(.21,.17,.11),pebble)

def ribbon():
    base()
    for i in range(14):
        a=i*2.4;h=random.uniform(1.4,2.6);r=random.uniform(.15,.5);pts=[];v=[];f=[]
        for k in range(19):
            t=k/18; c=Vector((math.cos(a)*(r*t+.28*t*t),math.sin(a)*(r*t+.28*t*t),.07+h*t))
            c.x+=.12*math.sin(t*5+i)*t;pts.append(c)
            side=Vector((math.cos(a+t),math.sin(a+t),0));w=.09*(math.sin(math.pi*t)**.45)+.003
            v.extend([c-side*w,c+Vector((0,0,.025)),c+side*w])
        for k in range(18):
            for j in range(2):n=k*3+j;f.append((n,n+1,n+4,n+3))
        o=mesh('Rippling grass blade',v,f,green if i%3 else lime);o.modifiers.new('Blade thickness','SOLIDIFY').thickness=.012

def broadleaf():
    base()
    for i in range(10):
        a=i*2.4;z=.4+(i%4)*.22;end=(.33*math.cos(a),.33*math.sin(a),z)
        tube('Curved petiole',[(0,0,.08),(.12*math.cos(a),.12*math.sin(a),z*.7),end],[.025,.022,.018],green)
        centers=leaf('Lanceolate leaf',end,(math.cos(a),math.sin(a),.48),.85,.48,green if i%2 else lime,.18)
        tube('Pale midrib',centers,[.009]*len(centers),vein,6)

def redstem():
    base()
    for k in range(5):
        a=k*2.4;x=.2*math.cos(a);y=.2*math.sin(a);h=1.5+k*.18
        tube('Burgundy stem',[(x,y,.06),(x+.08,y,h*.5),(x+.2,y,h)],[.024,.018,.01],bark,8)
        for j in range(6):
            z=.25+j*(h-.35)/6
            for sign in [0,math.pi]:
                angle=j*1.2+a+sign
                leaf('Copper leaf',(x+.2*z/h,y,z),(math.cos(angle),math.sin(angle),.38),.40-.025*j,.18,red if j%2 else copper,.09)

def driftwood():
    # Four sweeps sharing endpoints, so the branches read as one grown piece
    # rather than tubes meeting at a joint.
    paths=[([(-1.15,0,.19),(-.65,.08,.38),(0,0,.55),(.5,.15,1.1),(.8,.2,1.8)],[.25,.28,.23,.14,.025]),
           ([(0,0,.55),(.5,-.25,.55),(1.05,-.38,.9),(1.4,-.4,1.2)],[.18,.13,.08,.018]),
           ([(-.4,0,.4),(-.55,.32,.9),(-.9,.42,1.25)],[.15,.10,.018]),
           ([(.5,.15,1.1),(.18,.4,1.45),(.1,.5,1.75)],[.09,.06,.012])]
    for pts,rs in paths:
        tube('Worn hardwood',pts,rs,bark,12)
        # Three thin tubes riding just proud of each sweep: grain you can see
        # in silhouette, which a colour alone would not give.
        for i in range(3):
            off=Vector((0,(i-1)*.065,.055))
            tube('Raised wood grain',[Vector(p)+off for p in pts],[r*.09 for r in rs],wood,6)
    for i in range(4):
        a=i*1.6;tube('Spreading root',[(-.65,0,.28),(-.65+.35*math.cos(a),.35*math.sin(a),.12),(-.65+.65*math.cos(a),.65*math.sin(a),.045)],[.11,.07,.015],bark)
    for i in range(7):stone('Moss cushion',(-.8+i*.16,.03,.45+i*.018),(.14,.13,.075),moss)

def amphora():
    # One profile taken up the outside, over the lip and back down the inside,
    # so the mouth is a real hollow a fish can nose into rather than a cap.
    profile=[(.30,.03),(.46,.15),(.60,.5),(.57,.85),(.38,1.1),(.25,1.2),(.25,1.45),(.30,1.48),(.30,1.55),(.21,1.55),(.19,1.42),(.19,1.2),(.32,1.08),(.49,.83),(.52,.5),(.38,.18),(.20,.14)]
    v=[];f=[];N=40
    for r,z in profile:
        for i in range(N):
            a=i*math.tau/N;v.append((r*math.cos(a),r*math.sin(a),z+(.015*math.sin(a*5) if z>1.4 else 0)))
    for j in range(len(profile)-1):
        for i in range(N):a=j*N+i;b=j*N+(i+1)%N;f.append((a,b,b+N,a+N))
    f.append(tuple(reversed(range(N))));f.append(tuple((len(profile)-1)*N+i for i in range(N)))
    mesh('Hollow ceramic vessel',v,f,terracotta)
    for sign in [-1,1]:tube('Loop handle',[(sign*.25,0,1.38),(sign*.53,0,1.35),(sign*.73,0,1.10),(sign*.62,0,.82),(sign*.54,0,.8)],[.07]*5,terracotta,12)
    for z,r in [(.33,.555),(.91,.52)]:
        pts=[(r*math.cos(i*math.tau/40),r*math.sin(i*math.tau/40),z) for i in range(41)];tube('Incised decorative band',pts,[.018]*41,copper,6)
    tube('Dark hairline crack',[(.06,-.27,1.46),(.04,-.26,1.25),(.13,-.37,1.10),(.12,-.49,.95)],[.009]*4,bark,5)

builders={'ribbon-grass':ribbon,'broadleaf-plant':broadleaf,'red-stem-plant':redstem,'branching-driftwood':driftwood,'weathered-amphora':amphora}
assert list(builders) == SCENERY[:len(builders)], 'scenery_common.SCENERY and the builders here have drifted apart'
for name,build in builders.items():
    clear()
    # Fresh materials per asset: each .blend is saved on its own, so sharing
    # one set across the loop would leave later files pointing at nothing.
    green=material('Deep jade',(.055,.31,.16));lime=material('Leaf green',(.22,.49,.18));vein=material('Leaf vein',(.36,.55,.19));red=material('Wine red',(.40,.075,.11));copper=material('Warm copper',(.68,.23,.12));bark=material('Dark wood',(.16,.075,.035));wood=material('Wood grain',(.34,.19,.075));pebble=material('Warm slate',(.36,.40,.38));moss=material('Moss',(.18,.30,.065));terracotta=material('Terracotta',(.55,.25,.14))
    build()
    publish(name)
print('FISHTANK: scenery built. Now create_shipwreck.py, then render_scenery.py.')
