"""Rebuild our original stylized fish with Blender's bundled Python.
Run: blender --background --factory-startup --python tools/blender/create_fish.py [-- kinds... | -- --thumbnails-only kinds...]
Without kinds every species is built. --thumbnails-only re-renders menu thumbnails from the saved .blend files.
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
KINDS = ['clownfish', 'blue-tang', 'pufferfish', 'angelfish', 'goldfish', 'betta', 'shark']

def vec(p): return Vector((p[0], -p[2], p[1]))
def mat(name, color, rough=.4):
    m = bpy.data.materials.new(name)
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

def sphere(name, pos, scale, material, parent, segments=20, rings=12):
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
    sides=32; rings=24
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
    bevel=obj.modifiers.new('Soft fin edges','BEVEL');bevel.width=.025;bevel.segments=2
    bevel.affect='EDGES'
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj

def line(name, points, material, parent, width=.012):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=1
    data.bevel_depth=width;data.bevel_resolution=1
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
        sphere('Eye sparkle',(side*(width+.221),y+.058,z+.11),(.02,.034,.029),cream,parent,12,8)

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

def build(kind):
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
            sphere('Freckle',p,(.052,.047,.046),spot,root,12,8)
        for i in range(16):
            a=i*2.39996;z=-.6+(i%6)*.21;r=math.sqrt(1-(z/.91)**2)
            p=(.78*r*math.cos(a),.78*r*math.sin(a),z)
            if p[1]<-.25:continue
            sphere('Soft spine',p,(.065,.065,.065),cream,root,10,6)
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
    # Keep tail pivot local to its attachment for exported swim animation.
    tail=bpy.data.objects.new('Tail',None);bpy.context.collection.objects.link(tail);tail.parent=root
    for shape in tailshapes or [[(0,.12,-.83),(0,tailheight,-1.50),(0,.12,-1.43),(0,-tailheight,-1.50),(0,-.12,-.83)]]:
        fin('Tail fan',shape,tailmat,edge,tail,tailthickness)
    if rays is None: rays=[[(.039,0,-.91),(.039,i*tailheight*.40,-1.42)] for i in [-2,-1,0,1,2]]
    for points in rays: line('Fin ray',points,raymat or edge,tail,.008)
    static=merge_parts(root,'BodyMesh');tailmesh=merge_parts(tail,'TailMesh')
    # Move pivot without moving its geometry in world space.
    tail.location=vec((0,0,-.85));tailmesh.location=-tail.location
    for frame,angle in [(1,0),(7,.30),(13,0),(19,-.30),(25,0)]:
        tail.rotation_euler.z=angle;tail.keyframe_insert(data_path='rotation_euler',index=2,frame=frame)
    tail.animation_data.action.name='swim'
    scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root,static,tail,tailmesh]:o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{kind}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_frame_range=True,export_yup=True,export_cameras=False,export_lights=False)
    # Source files include studio lighting and a camera for easy inspection.
    studio(scene)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f'{kind}.blend'))
    scene.render.filepath=str(DOCS/f'{kind}.png');bpy.ops.render.render(write_still=True)
    thumbnail(kind)
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
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE/f'{kind}.blend'))
        thumbnail(kind)
    print(f'FISHTANK: Thumbnails rendered for {", ".join(kinds)}.')
else:
    for kind in kinds:build(kind)
    print(f'FISHTANK: Built {", ".join(kinds)} (Blender sources, GLBs, previews, thumbnails).')
