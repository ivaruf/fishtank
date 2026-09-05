"""Rebuild our original stylized fish with Blender's bundled Python.
Run: blender --background --factory-startup --python tools/blender/create_fish.py
Authoring coordinates below are X right, Y up, Z forward; convert to Blender Z up.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'client/assets/models'
SOURCE = ROOT / 'assets/blender'
DOCS = ROOT / 'docs'
for path in [OUT, SOURCE, DOCS]: path.mkdir(parents=True, exist_ok=True)

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
    root=bpy.data.objects.new(kind,None);bpy.context.collection.objects.link(root)
    root['forward']='+Z in glTF';root['style']='Original Fishtank stylized fish'
    if kind=='clownfish':
        body(root,(.43,.59,1.06),[orange,cream,dark],kind)
        eyes(root,.32,.16,.73,cream,dark,gold)
        fin('Dorsal',[(0,.40,.65),(0,.76,.3),(0,.79,-.18),(0,.58,-.83),(0,.34,-.72)],orange,dark,root)
        fin('Ventral',[(0,-.38,.13),(0,-.75,-.22),(0,-.55,-.71)],orange,dark,root)
        for side in [-1,1]:
            fin('Pectoral',[(side*.33,-.08,.45),(side*.72,-.30,.05),(side*.61,-.38,-.24),(side*.36,-.15,-.22)],gold,dark,root,.016)
        line('Smile',[(-.12,-.13,1.027),(0,-.16,1.058),(.12,-.13,1.027)],dark,root,.015)
        tailmat=orange;edge=dark;tailheight=.51
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
    else:
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
    # Keep tail pivot local to its attachment for exported swim animation.
    tail=bpy.data.objects.new('Tail',None);bpy.context.collection.objects.link(tail);tail.parent=root
    fin('Tail fan',[(0,.12,-.83),(0,tailheight,-1.50),(0,.12,-1.43),(0,-tailheight,-1.50),(0,-.12,-.83)],tailmat,edge,tail)
    for i in [-2,-1,0,1,2]:
        line('Fin ray',[(.039,0,-.91),(.039,i*tailheight*.40,-1.42)],cream if kind=='clownfish' else edge,tail,.008)
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
    return kind

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

for kind in ['clownfish','blue-tang','pufferfish']:build(kind)
print('FISHTANK: Three Blender sources, GLBs, and previews exported.')
