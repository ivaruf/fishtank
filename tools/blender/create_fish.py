"""Rebuild our original stylized fish with Blender's bundled Python.
Run: blender --background --factory-startup --python tools/blender/create_fish.py [-- kinds...] [-- --thumbnails-only | --hd-only kinds...]
Without kinds every species is built, each as a standard .glb plus a denser -hd.glb for the Ultra quality
setting. --thumbnails-only re-renders menu thumbnails from the saved .blend files; --hd-only exports only the
high-detail models.
--models-only skips preview and menu-thumbnail generation.
Authoring coordinates below are X right, Y up, Z forward; convert to Blender Z up.
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'client/assets/models'
THUMBS = ROOT / 'client/assets/thumbs'
SOURCE = ROOT / 'assets/blender'
DOCS = ROOT / 'docs'
for path in [OUT, THUMBS, SOURCE, DOCS]: path.mkdir(parents=True, exist_ok=True)
KINDS = ['clownfish', 'blue-tang', 'pufferfish', 'angelfish', 'goldfish', 'betta', 'shark', 'butterflyfish', 'lionfish', 'wrasse', 'seahorse', 'manta-ray', 'royal-gramma', 'triggerfish']
# Species with authored four-tier detail, mapped to the module supplying their
# enhance(builder, root, kind, detail, palette) and tail(...) layers. Anything
# listed here builds low/standard/high/hd; the rest stay standard plus HD.
DETAIL_MODULES = {
    'clownfish': 'clownfish_detail',
    'blue-tang': 'reef_detail',
    'pufferfish': 'reef_detail',
    'goldfish': 'flowing_detail',
    'betta': 'flowing_detail',
    'angelfish': 'flowing_detail',
    'butterflyfish': 'patterned_detail',
    'wrasse': 'patterned_detail',
    'royal-gramma': 'patterned_detail',
    'triggerfish': 'patterned_detail',
    'lionfish': 'pelagic_detail',
    'seahorse': 'pelagic_detail',
    'manta-ray': 'pelagic_detail',
    'shark': 'pelagic_detail',
}
# Tessellation per quality tier: (segments, rings) for spheres, bevel/curve resolution for fins and rays.
DETAIL = {
    'low': dict(body=(20,14), sphere=(12,8), small=(10,6), tiny=(8,4), bevel=1, curve=0, suffix='-low'),
    'high': dict(body=(40,30), sphere=(24,14), small=(12,8), tiny=(10,6), bevel=2, curve=1, suffix='-high'),
    'standard': dict(body=(32, 24), sphere=(20, 12), small=(12, 8), tiny=(10, 6), bevel=2, curve=1, suffix=''),
    'hd': dict(body=(72, 54), sphere=(36, 20), small=(16, 10), tiny=(14, 8), bevel=4, curve=3, suffix='-hd'),
}
LEVEL = DETAIL['standard']
# Every material built for the current species, keyed by name, so detail modules
# can reach both the shared palette and a species' own colors without wiring.
PALETTE = {}

def vec(p): return Vector((p[0], -p[2], p[1]))
def mat(name, color, rough=.4):
    m = bpy.data.materials.new(name)
    PALETTE[name] = m
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m

def mesh(name, vertices, faces, material, parent):
    data = bpy.data.meshes.new(name)
    data.from_pydata([vec(v) for v in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    return obj

def sphere(name, pos, scale, material, parent, segments=None, rings=None):
    segments, rings = (segments, rings) if segments else LEVEL['sphere']
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=vec(pos))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = parent
    for p in obj.data.polygons: p.use_smooth = True
    return obj

def body(parent, scale, materials, kind):
    w,h,l = scale
    vertices=[]; faces=[]; indices=[]
    sides,rings=LEVEL['body']
    for row in range(rings+1):
        t=math.pi*row/rings
        z=l*math.cos(t)
        for col in range(sides):
            a=2*math.pi*col/sides
            vertices.append((w*math.sin(t)*math.cos(a), h*math.sin(t)*math.sin(a), z))
    for row in range(rings):
        z=l*math.cos(math.pi*(row+.5)/rings)
        for col in range(sides):
            faces.append((row*sides+col,row*sides+(col+1)%sides,(row+1)*sides+(col+1)%sides,(row+1)*sides+col))
            a=2*math.pi*(col+.5)/sides
            index=0
            if kind=='clownfish':
                dist=min(abs(z-.69),abs(z+.04),abs(z+.72))
                index=1 if dist<.09 else 2 if dist<.135 else 0
            elif kind=='pufferfish' and math.sin(a)<-.24: index=1
            elif kind=='angelfish' and min(abs(z-.42),abs(z+.02),abs(z+.46))<.075: index=1
            elif kind=='goldfish' and math.sin(a)<-.6: index=1
            elif kind=='betta' and math.sin(a)>.8: index=1
            elif kind=='shark' and math.sin(a)<-.3: index=1
            elif kind=='butterflyfish':
                if abs(z-.49)<.12: index=1
                elif abs(z+.59)<.055: index=2
            elif kind=='lionfish':
                if math.cos(z*19+math.sin(a)*.7)>.3: index=1
            elif kind=='royal-gramma' and z<-.05: index=1
            elif kind=='triggerfish' and z>.58: index=1
            elif kind=='wrasse':
                if abs(math.sin(a)-.23)<.15 or abs(math.sin(a)+.38)<.10: index=1
                elif math.sin(a)<-.7: index=2
            indices.append(index)
    obj=mesh('Body',vertices,faces,materials[0],parent)
    for m in materials[1:]:obj.data.materials.append(m)
    for p,i in zip(obj.data.polygons,indices): p.material_index=i;p.use_smooth=True
    return obj

def fin(name, points, material, edge, parent, thickness=.035):
    # Extrude a silhouette through its lateral axis, including a dark edge rim.
    vertices=[(x+offset,y,z) for offset in [-thickness,thickness] for x,y,z in points]
    n=len(points)
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj=mesh(name,vertices,faces,material,parent)
    obj.data.materials.append(edge)
    for p in list(obj.data.polygons)[2:]:p.material_index=1
    bevel=obj.modifiers.new('Soft fin edges','BEVEL');bevel.width=.025;bevel.segments=LEVEL['bevel']
    bevel.affect='EDGES'
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj

def line(name, points, material, parent, width=.012):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=1
    data.bevel_depth=width;data.bevel_resolution=LEVEL['curve']
    spline=data.splines.new('POLY');spline.points.add(len(points)-1)
    for p,v in zip(spline.points,points):p.co=(*vec(v),1)
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    obj.parent=parent;obj.data.materials.append(material)
    return obj

def eyes(parent, width, y, z, cream, dark, iris):
    for side in [-1,1]:
        sphere('Eye socket',(side*width,y,z),(.19,.215,.20),dark,parent)
        sphere('Eye white',(side*(width+.055),y+.012,z+.035),(.166,.185,.17),cream,parent)
        sphere('Iris',(side*(width+.155),y+.015,z+.073),(.077,.12,.108),iris,parent)
        sphere('Pupil',(side*(width+.19),y+.015,z+.094),(.052,.079,.073),dark,parent)
        sphere('Eye sparkle',(side*(width+.221),y+.058,z+.11),(.02,.034,.029),cream,parent,*LEVEL['small'])

def merge_parts(parent,name):
    # One static mesh and one tail mesh; retain material slots for GPU instancing.
    parts=[o for o in parent.children if o.type in {'MESH','CURVE'}]
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    obj=bpy.context.object;obj.name=name
    bpy.context.scene.cursor.location=(0,0,0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    # Remove degenerate pole triangles before export.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    return obj

def build(kind, detail='standard', models_only=False):
    global LEVEL
    LEVEL=DETAIL[detail]
    PALETTE.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.render.fps=24;scene.frame_start=1;scene.frame_end=25
    cream=mat('Pearl',(1,.91,.72));dark=mat('Ink',(.018,.032,.055),.3)
    orange=mat('Tangerine',(1,.24,.025));gold=mat('Honey',(1,.62,.08))
    blue=mat('Lagoon',(.025,.32,.9));navy=mat('Midnight',(.015,.045,.16))
    mint=mat('Seafoam',(.27,.68,.40));spot=mat('Freckles',(.065,.25,.16))
    silver=mat('Moonlight',(.62,.70,.78),.35);marigold=mat('Marigold',(1,.42,.03))
    garnet=mat('Garnet',(.55,.02,.07),.35);violet=mat('Amethyst',(.30,.05,.55),.35)
    slate=mat('Slate',(.22,.29,.36),.45)
    root=bpy.data.objects.new(kind,None);bpy.context.collection.objects.link(root)
    root['forward']='+Z in glTF';root['style']='Original Fishtank stylized fish'
    tailshapes=None;rays=None;raymat=None;tailthickness=.035
    tailcurve=None;tailpivot=(0,0,-.85);tailwidth=.035
    if kind=='clownfish':
        body(root,(.43,.59,1.06),[orange,cream,dark],kind)
        eyes(root,.32,.16,.73,cream,dark,gold)
        fin('Dorsal',[(0,.40,.65),(0,.76,.3),(0,.79,-.18),(0,.58,-.83),(0,.34,-.72)],orange,dark,root)
        fin('Ventral',[(0,-.38,.13),(0,-.75,-.22),(0,-.55,-.71)],orange,dark,root)
        for side in [-1,1]:
            fin('Pectoral',[(side*.33,-.08,.45),(side*.72,-.30,.05),(side*.61,-.38,-.24),(side*.36,-.15,-.22)],gold,dark,root,.016)
        line('Smile',[(-.12,-.13,1.027),(0,-.16,1.058),(.12,-.13,1.027)],dark,root,.015)
        tailmat=orange;edge=dark;tailheight=.51;raymat=cream
    elif kind=='blue-tang':
        body(root,(.31,.66,1.02),[blue],kind)
        eyes(root,.235,.23,.70,cream,dark,gold)
        for side in [-1,1]:
            sphere('Royal marking',(side*.269,.02,-.17),(.065,.40,.64),navy,root)
            sphere('Lagoon marking',(side*.323,-.01,-.12),(.023,.21,.32),blue,root)
            fin('Pectoral',[(side*.26,-.10,.43),(side*.59,-.28,.03),(side*.44,-.31,-.20)],gold,navy,root,.015)
        fin('Sail dorsal',[(0,.43,.60),(0,.89,.05),(0,.82,-.48),(0,.23,-.94)],blue,navy,root)
        fin('Sail ventral',[(0,-.36,.5),(0,-.82,-.03),(0,-.62,-.60),(0,-.2,-.92)],blue,navy,root)
        line('Smile',[(-.085,-.075,.998),(0,-.11,1.027),(.085,-.075,.998)],dark,root)
        tailmat=gold;edge=navy;tailheight=.55
    elif kind=='pufferfish':
        body(root,(.77,.77,.90),[mint,cream],kind)
        eyes(root,.39,.27,.67,cream,dark,gold)
        for side in [-1,1]:
            fin('Little flipper',[(side*.65,-.04,.12),(side*1.01,-.12,-.10),(side*.95,-.36,-.31),(side*.68,-.25,-.14)],gold,orange,root,.018)
        fin('Little dorsal',[(0,.65,-.12),(0,.99,-.42),(0,.59,-.61)],gold,orange,root)
        for i in range(30):
            a=i*2.39996;t=.32+(i%7)/7*1.6
            p=(.774*math.sin(t)*math.cos(a),.774*math.sin(t)*math.sin(a),.905*math.cos(t))
            if p[1]<-.18 or p[2]>.68:continue
            sphere('Freckle',p,(.052,.047,.046),spot,root,*LEVEL['small'])
        for i in range(16):
            a=i*2.39996;z=-.6+(i%6)*.21;r=math.sqrt(1-(z/.91)**2)
            p=(.78*r*math.cos(a),.78*r*math.sin(a),z)
            if p[1]<-.25:continue
            sphere('Soft spine',p,(.065,.065,.065),cream,root,*LEVEL['tiny'])
        sphere('Muzzle',(0,-.025,.865),(.18,.135,.09),cream,root)
        sphere('Mouth',(0,-.035,.946),(.07,.065,.016),dark,root)
        tailmat=gold;edge=orange;tailheight=.32
    elif kind=='angelfish':
        # Tall, thin disc with black bars and sail fins trailing gold streamers.
        body(root,(.20,.76,.82),[silver,dark],kind)
        eyes(root,.15,.20,.50,cream,dark,gold)
        fin('Sail dorsal',[(0,.52,.36),(0,1.18,-.12),(0,1.05,-.55),(0,.36,-.66)],silver,dark,root,.03)
        fin('Sail ventral',[(0,-.48,.32),(0,-1.12,-.16),(0,-.98,-.56),(0,-.32,-.66)],silver,dark,root,.03)
        for side in [-1,1]:
            fin('Pectoral',[(side*.17,-.04,.34),(side*.46,-.20,.05),(side*.36,-.28,-.14)],gold,dark,root,.014)
            line('Streamer',[(side*.07,-.36,.28),(side*.11,-1.15,-.05)],gold,root,.012)
        line('Smile',[(-.07,-.10,.80),(0,-.13,.825),(.07,-.10,.80)],dark,root,.012)
        tailmat=silver;edge=dark;tailheight=.50
    elif kind=='goldfish':
        # Plump body, cream belly, big flowing double fantail.
        body(root,(.50,.56,.90),[marigold,cream],kind)
        eyes(root,.38,.17,.62,cream,dark,gold)
        fin('Dorsal',[(0,.46,.42),(0,.86,.04),(0,.74,-.40),(0,.42,-.70)],marigold,orange,root)
        fin('Ventral',[(0,-.44,.05),(0,-.78,-.30),(0,-.48,-.56)],marigold,orange,root)
        for side in [-1,1]:
            fin('Pectoral',[(side*.42,-.10,.35),(side*.85,-.30,-.05),(side*.70,-.42,-.30),(side*.45,-.20,-.20)],marigold,orange,root,.016)
        line('Smile',[(-.10,-.12,.88),(0,-.15,.91),(.10,-.12,.88)],dark,root,.013)
        tailmat=marigold;edge=orange;tailheight=.72
        tailthickness=.018
        tailshapes=[[(s*.06,.10,-.83),(s*.22,.58,-1.30),(s*.30,.74,-1.52),(s*.36,.50,-1.74),(s*.30,.14,-1.40),(s*.30,-.14,-1.40),(s*.36,-.50,-1.74),(s*.30,-.74,-1.52),(s*.22,-.58,-1.30),(s*.06,-.10,-.83)] for s in [-1,1]]
        rays=[[(s*.08,0,-.90),(s*.30,i*.30,-1.46)] for s in [-1,1] for i in [-1,0,1]]
    elif kind=='betta':
        # Slender fighting fish with a violet sheen and huge veil fins.
        body(root,(.30,.42,1.00),[garnet,violet],kind)
        eyes(root,.22,.15,.72,cream,dark,gold)
        fin('Veil dorsal',[(0,.34,.30),(0,.94,-.05),(0,1.04,-.55),(0,.74,-1.00),(0,.24,-.76)],violet,garnet,root,.03)
        fin('Veil anal',[(0,-.30,.36),(0,-.94,.06),(0,-1.08,-.50),(0,-.70,-1.00),(0,-.20,-.80)],violet,garnet,root,.03)
        for side in [-1,1]:
            fin('Pectoral',[(side*.28,-.05,.45),(side*.70,-.25,.10),(side*.55,-.35,-.20),(side*.30,-.12,-.20)],violet,garnet,root,.015)
            line('Pelvic streamer',[(side*.10,-.34,.30),(side*.14,-.95,-.05)],violet,root,.018)
        line('Smile',[(-.09,-.10,.97),(0,-.13,1.00),(.09,-.10,.97)],dark,root,.012)
        tailmat=violet;edge=garnet;tailheight=.85
        tailshapes=[[(0,.12,-.83),(0,.85,-1.30),(0,.95,-1.75),(0,0,-1.90),(0,-.95,-1.75),(0,-.85,-1.30),(0,-.12,-.83)]]
        rays=[[(.039,0,-.91),(.039,i*.34,-1.62)] for i in [-2,-1,0,1,2]]
    elif kind=='butterflyfish':
        # A deep lemon disc, dark eye band, rear eyespot, and small pointed snout.
        lemon=mat('Lemon',(1,.77,.035));citron=mat('Citron',(1,.93,.32))
        body(root,(.25,.66,.89),[lemon,dark,cream],kind)
        eyes(root,.19,.20,.49,cream,dark,gold)
        sphere('Pointed snout',(0,-.015,.86),(.13,.14,.19),lemon,root)
        line('Mouth',[(-.065,-.035,1.025),(0,-.055,1.052),(.065,-.035,1.025)],dark,root)
        fin('Rounded dorsal',[(0,.43,.57),(0,.76,.27),(0,.82,-.22),(0,.62,-.74),(0,.23,-.78)],citron,orange,root,.025)
        fin('Rounded anal',[(0,-.43,.45),(0,-.73,.12),(0,-.72,-.36),(0,-.31,-.77)],citron,orange,root,.025)
        for side in [-1,1]:
            sphere('Eyespot rim',(side*.202,.28,-.46),(.037,.16,.16),cream,root)
            sphere('False eyespot',(side*.235,.28,-.46),(.021,.115,.115),dark,root)
            fin('Pectoral',[(side*.23,-.06,.27),(side*.56,-.19,.01),(side*.41,-.29,-.19)],citron,orange,root,.014)
            for i in range(3):
                line('Dorsal ray',[(side*.031,.49,-.03-i*.14),(side*.031,.74-i*.04,-.16-i*.14)],lemon,root,.009)
        tailmat=lemon;edge=dark;tailheight=.38;raymat=cream
    elif kind=='lionfish':
        # Broad striped body, radiating pectoral fans, and a crown of dorsal spines.
        rust=mat('Rust',( .50,.085,.035));ivory=mat('Ivory',(1,.82,.54))
        body(root,(.43,.49,.96),[rust,ivory],kind)
        eyes(root,.33,.18,.64,cream,dark,gold)
        sphere('Lower lip',(0,-.17,.86),(.23,.10,.13),ivory,root)
        line('Mouth',[(-.12,-.15,.94),(0,-.18,.98),(.12,-.15,.94)],dark,root,.012)
        for i in range(7):
            z=.52-i*.19;h=.95+.22*math.sin(i*.65)
            fin('Dorsal spine',[(0,.31,z+.055),(0,h,z-.16),(0,.34,z-.13)],ivory,rust,root,.016)
            if i<6:fin('Dorsal web',[(0,.36,z),(0,h*.77,z-.13),(0,.43,z-.29)],rust,ivory,root,.013)
        for side in [-1,1]:
            origin=(side*.34,-.07,.26)
            tips=[(side*(.76+.38*math.sin(i*math.pi/5)),.16-i*.13,.23-i*.23) for i in range(6)]
            for i in range(5):
                fin('Fan membrane',[origin,tips[i],tips[i+1]],rust,ivory,root,.014)
            for tip in tips:
                line('Fan spine',[origin,tip,(tip[0]*1.08,tip[1]-.035,tip[2]-.045)],ivory,root,.02)
            line('Brow tassel',[(side*.30,.34,.72),(side*.37,.69,.63)],ivory,root,.018)
        tailmat=ivory;edge=rust;tailheight=.43;raymat=rust
    elif kind=='wrasse':
        # Streamlined green reef fish with pink ribbons and a continuous low dorsal.
        jade=mat('Jade',(.015,.62,.43));rose=mat('Coral pink',(.92,.09,.28))
        body(root,(.30,.36,1.12),[jade,rose,cream],kind)
        eyes(root,.225,.115,.79,cream,dark,gold)
        fin('Long dorsal',[(0,.26,.74),(0,.47,.49),(0,.50,-.33),(0,.26,-.97),(0,.17,-.78)],jade,rose,root,.025)
        fin('Anal',[(0,-.24,.03),(0,-.48,-.35),(0,-.24,-.92)],jade,rose,root,.02)
        for side in [-1,1]:
            fin('Pectoral',[(side*.26,-.04,.46),(side*.63,-.20,.12),(side*.45,-.29,-.16)],gold,rose,root,.014)
            line('Cheek ribbon',[(side*.225,.02,.86),(side*.282,-.08,.62),(side*.29,-.10,.44)],rose,root,.019)
        line('Smile',[(-.09,-.07,1.09),(0,-.10,1.12),(.09,-.07,1.09)],dark,root,.012)
        tailmat=jade;edge=rose;tailheight=.38;raymat=gold
        tailshapes=[[(0,.10,-.92),(0,.39,-1.38),(0,.29,-1.58),(0,0,-1.45),(0,-.29,-1.58),(0,-.39,-1.38),(0,-.10,-.92)]]
    elif kind=='royal-gramma':
        # A crisp purple-to-yellow split, low scalloped dorsal, and a dark eyestripe.
        orchid=mat('Orchid',(.40,.025,.72));sunshine=mat('Sunshine',(1,.72,.025))
        body(root,(.31,.42,1.02),[orchid,sunshine],kind)
        eyes(root,.235,.14,.73,cream,dark,gold)
        fin('Purple dorsal',[(0,.31,.61),(0,.60,.40),(0,.61,.06),(0,.34,-.08)],orchid,violet,root,.023)
        fin('Golden dorsal',[(0,.35,-.07),(0,.60,-.12),(0,.48,-.61),(0,.18,-.92)],sunshine,orange,root,.023)
        fin('Anal',[(0,-.32,-.06),(0,-.57,-.36),(0,-.23,-.87)],sunshine,orange,root,.02)
        for side in [-1,1]:
            fin('Pectoral',[(side*.28,-.05,.36),(side*.62,-.24,.03),(side*.43,-.32,-.22)],orchid,violet,root,.014)
            line('Eye stripe',[(side*.26,.22,.78),(side*.29,.12,.52),(side*.29,.03,.37)],dark,root,.015)
            sphere('Dorsal eyespot',(side*.032,.51,.28),(.018,.066,.077),dark,root,*LEVEL['small'])
        line('Smile',[(-.08,-.09,.99),(0,-.12,1.026),(.08,-.09,.99)],dark,root,.012)
        tailmat=sunshine;edge=orange;tailheight=.41;raymat=cream
    elif kind=='triggerfish':
        # Clown triggerfish-inspired spots, yellow saddle, stout mouth, and trigger spine.
        charcoal=mat('Charcoal',(.035,.065,.10));ochre=mat('Saffron',(1,.59,.025))
        body(root,(.34,.56,.96),[charcoal,ochre],kind)
        eyes(root,.245,.25,.62,cream,dark,ochre)
        sphere('Lip',(0,-.07,.928),(.16,.115,.10),ochre,root)
        line('Mouth',[(-.08,-.08,1.00),(0,-.11,1.03),(.08,-.08,1.00)],dark,root,.014)
        fin('Trigger spine',[(0,.46,.27),(0,.95,.17),(0,.57,.06)],ochre,dark,root,.023)
        fin('Rear dorsal',[(0,.41,-.17),(0,.72,-.47),(0,.22,-.89)],cream,ochre,root,.026)
        fin('Anal',[(0,-.38,-.12),(0,-.66,-.46),(0,-.21,-.86)],cream,ochre,root,.026)
        for side in [-1,1]:
            fin('Pectoral',[(side*.30,-.04,.28),(side*.64,-.20,-.02),(side*.43,-.33,-.23)],ochre,dark,root,.015)
            for row in range(3):
                for col in range(4):
                    y=-.33+row*.18;z=-.53+col*.22+(row%2)*.06
                    x=.343*math.sqrt(max(.01,1-(y/.56)**2-(z/.96)**2))
                    sphere('Pearl spot',(side*x,y,z),(.037,.060,.066),cream,root,*LEVEL['small'])
            for i in range(4):
                line('Saddle fleck',[(side*.19,.43,-.16-i*.10),(side*.22,.40,-.19-i*.10)],ochre,root,.027)
        tailmat=charcoal;edge=ochre;tailheight=.46;raymat=cream
    elif kind=='seahorse':
        # Upright plated trunk, curved neck, tubular snout, coronet and curled prehensile tail.
        peach=mat('Apricot',(1,.43,.16));ridge=mat('Golden ridges',(1,.74,.30))
        sphere('Trunk',(0,-.05,-.10),(.25,.52,.31),peach,root)
        sphere('Belly',(0,-.10,.115),(.20,.39,.16),ridge,root)
        sphere('Neck',(0,.43,-.045),(.17,.35,.19),peach,root)
        sphere('Head',(0,.69,.18),(.25,.25,.31),peach,root)
        sphere('Tube snout',(0,.61,.52),(.115,.115,.29),ridge,root)
        sphere('Mouth',(0,.61,.80),(.079,.077,.014),dark,root)
        eyes(root,.19,.77,.29,cream,dark,gold)
        for i in range(4):
            z=-.01+i*.095
            fin('Coronet',[(0,.81,z-.03),(0,1.07+(i%2)*.09,z),(0,.84,z+.06)],ridge,peach,root,.024)
        for i in range(6):
            y=-.39+i*.135
            line('Trunk ridge',[(-.20,y,.10),(0,y,.275),(.20,y,.10)],ridge,root,.018)
            fin('Back plate',[(0,y,-.32),(0,y+.09,-.47),(0,y+.16,-.31)],ridge,peach,root,.025)
        for side in [-1,1]:
            fin('Tiny ear fin',[(side*.13,.48,.02),(side*.39,.36,-.12),(side*.17,.28,-.03)],cream,peach,root,.014)
        fin('Dorsal fan',[(0,.17,-.30),(0,.17,-.63),(0,-.20,-.65),(0,-.28,-.28)],cream,peach,root,.022)
        tailmat=peach;edge=ridge;rays=[];tailwidth=.095;tailpivot=(0,-.40,-.10)
        tailcurve=[(0,-.40,-.10),(0,-.64,-.17),(0,-.84,-.15)]
        for i in range(1,29):
            t=i/28;angle=math.pi+t*math.pi*1.75;r=.27*(1-t)+.035*t
            tailcurve.append((0,-.84+r*math.sin(angle),.12+r*math.cos(angle)))
    elif kind=='manta-ray':
        # One closed, softly cambered diamond with a pale underside and long whip tail.
        ocean=mat('Ocean slate',(.055,.20,.29));belly=mat('Cloud belly',(.80,.89,.84))
        vertices=[];faces=[];nx,nz=LEVEL['body'][0],max(8,LEVEL['body'][1]*2//3)
        for lower in [False,True]:
            for i in range(nx+1):
                u=-1+2*i/nx;a=abs(u);leading=.88*(1-a)-.17*a;trailing=-.78+.53*a
                for j in range(nz+1):
                    v=j/nz;z=leading*(1-v)+trailing*v
                    y=(.17*math.sin(math.pi*v)*(1-a*a)+.07*a) * (-.6 if lower else 1)
                    vertices.append((u*1.43,y,z))
        layer=(nx+1)*(nz+1)
        for side in [0,1]:
            for i in range(nx):
                for j in range(nz):
                    k=side*layer+i*(nz+1)+j
                    face=(k,k+nz+1,k+nz+2,k+1)
                    faces.append(face if side==0 else tuple(reversed(face)))
        for i in range(nx):
            for j in [0,nz]:
                k=i*(nz+1)+j;faces.append((k,k+nz+1,k+nz+1+layer,k+layer))
        for i in [0,nx]:
            for j in range(nz):
                k=i*(nz+1)+j;faces.append((k,k+1,k+1+layer,k+layer))
        wings=mesh('Wing disc',vertices,faces,ocean,root);wings.data.materials.append(belly)
        for poly in wings.data.polygons:poly.use_smooth=True;poly.material_index=1 if nx*nz<=poly.index<2*nx*nz else 0
        sphere('Head',(0,.035,.49),(.39,.15,.36),ocean,root)
        eyes(root,.265,.10,.60,cream,dark,blue)
        for side in [-1,1]:
            line('Cephalic lobe',[(side*.30,.015,.68),(side*.34,-.015,.91),(side*.25,.015,1.06)],ocean,root,.070)
            line('Wing highlight',[(side*.40,.11,.24),(side*.91,.105,-.02),(side*1.27,.08,-.14)],silver,root,.015)
        line('Smile',[(-.15,-.07,.80),(0,-.11,.84),(.15,-.07,.80)],dark,root,.014)
        fin('Dorsal',[(0,.10,-.43),(0,.37,-.68),(0,.035,-.77)],ocean,dark,root,.025)
        tailmat=ocean;edge=dark;rays=[];tailwidth=.043;tailpivot=(0,0,-.67)
        tailcurve=[(0,0,-.67),(0,.01,-.91),(0,.055,-1.19),(0,.09,-1.45),(0,.055,-1.72)]
    else:
        # Sleek grey shark: swept fins, gill slits, a wide grin and a crescent tail.
        body(root,(.34,.40,1.08),[slate,cream],kind)
        eyes(root,.26,.12,.70,cream,dark,dark)
        fin('Dorsal',[(0,.35,.25),(0,.98,-.35),(0,.62,-.42),(0,.30,-.45)],slate,dark,root)
        fin('Second dorsal',[(0,.20,-.70),(0,.42,-.90),(0,.14,-.92)],slate,dark,root,.025)
        for side in [-1,1]:
            fin('Pectoral',[(side*.30,-.10,.30),(side*.95,-.35,-.20),(side*.90,-.40,-.45),(side*.35,-.15,-.15)],slate,dark,root,.02)
            fin('Pelvic',[(side*.15,-.35,-.35),(side*.35,-.55,-.60),(side*.20,-.36,-.65)],slate,dark,root,.015)
            for i in range(3):
                line('Gill',[(side*.335,.12,.36-i*.09),(side*.34,-.10,.34-i*.09)],dark,root,.008)
        line('Grin',[(-.20,-.20,.85),(0,-.25,.98),(.20,-.20,.85)],dark,root,.014)
        tailmat=slate;edge=dark;tailheight=.60
        tailshapes=[[(0,.10,-.83),(0,.78,-1.55),(0,.62,-1.62),(0,.05,-1.25),(0,-.45,-1.50),(0,-.55,-1.45),(0,-.10,-.83)]]
        rays=[]
    # Authored detail layers replace the blocky fins above on every tier but Low.
    layers=None
    if kind in DETAIL_MODULES and detail!='low':
        sys.path.insert(0,str(Path(__file__).parent))
        layers=__import__(DETAIL_MODULES[kind])
        fin_highlight=layers.enhance(sys.modules[__name__],root,kind,detail,PALETTE)
    # Keep tail pivot local to its attachment for exported swim animation.
    tail=bpy.data.objects.new('Tail',None);bpy.context.collection.objects.link(tail);tail.parent=root
    if layers:
        layers.tail(sys.modules[__name__],tail,kind,detail,tailmat,edge,fin_highlight)
        rays=[]
    elif tailcurve:
        curve=line('Curved tail',tailcurve,tailmat,tail,tailwidth)
        for i,point in enumerate(curve.data.splines[0].points):point.radius=1-.82*i/(len(tailcurve)-1)
    else:
        for shape in tailshapes or [[(0,.12,-.83),(0,tailheight,-1.50),(0,.12,-1.43),(0,-tailheight,-1.50),(0,-.12,-.83)]]:
            fin('Tail fan',shape,tailmat,edge,tail,tailthickness)
    if rays is None: rays=[[(.039,0,-.91),(.039,i*tailheight*.40,-1.42)] for i in [-2,-1,0,1,2]]
    for points in rays: line('Fin ray',points,raymat or edge,tail,.008)
    static=merge_parts(root,'BodyMesh');tailmesh=merge_parts(tail,'TailMesh')
    # Move pivot without moving its geometry in world space.
    tail.location=vec(tailpivot);tailmesh.location=-tail.location
    for frame,angle in [(1,0),(7,.30),(13,0),(19,-.30),(25,0)]:
        tail.rotation_euler.z=angle;tail.keyframe_insert(data_path='rotation_euler',index=2,frame=frame)
    tail.animation_data.action.name='swim'
    scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root,*root.children_recursive]:o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(OUT/f"{kind}{LEVEL['suffix']}.glb"),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_frame_range=True,export_yup=True,export_cameras=False,export_lights=False)
    if detail!='standard' and kind not in DETAIL_MODULES: return kind
    # Source files include studio lighting and a camera for easy inspection.
    studio(scene)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f"{kind}{LEVEL['suffix']}.blend"))
    if models_only: return kind
    scene.render.filepath=str(DOCS/f"{kind}{LEVEL['suffix']}.png");bpy.ops.render.render(write_still=True)
    if detail=='standard': thumbnail(kind)
    return kind

def thumbnail(kind):
    # Small transparent render for the species picker in the menu.
    scene=bpy.context.scene
    scene.render.resolution_percentage=24
    scene.render.filepath=str(THUMBS/f'{kind}.png');bpy.ops.render.render(write_still=True)
    scene.render.resolution_percentage=100

def studio(scene):
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=900;scene.render.resolution_y=750;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('Deep teal studio');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.08,.15,.18,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    scene.view_settings.view_transform='AgX'
    bpy.ops.object.camera_add(location=(3,-4,1.8));camera=bpy.context.object;camera.name='Studio Camera'
    camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=3.8;scene.camera=camera
    for name,loc,power,size,color in [('Key',(2,-3,5),450,4,(1,.86,.69)),('Fill',(-3,-1,1.5),220,3,(.50,.80,1)),('Rim',(1,3,3),550,3,(.62,1,.89))]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name=name
        light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.data.color=color
        light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.image_settings.file_format='PNG'
    scene.render.film_transparent=True

args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
kinds=[a for a in args if a in KINDS] or KINDS
if '--thumbnails-only' in args:
    for kind in kinds:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE/f"{kind}{LEVEL['suffix']}.blend"))
        thumbnail(kind)
    print(f'FISHTANK: Thumbnails rendered for {", ".join(kinds)}.')
elif '--hd-only' in args:
    for kind in kinds:build(kind,'hd')
    print(f'FISHTANK: High-detail models exported for {", ".join(kinds)}.')
else:
    for kind in kinds:
        if kind in DETAIL_MODULES:
            for detail in ['low','standard','high','hd']:build(kind,detail,models_only='--models-only' in args)
        else:build(kind,models_only='--models-only' in args);build(kind,'hd')
    print(f'FISHTANK: Built {", ".join(kinds)} (Blender sources, standard and HD GLBs).')
