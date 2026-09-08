"""Shared scaffolding for the aquarium scenery pack: where the pack's files go,
and the mesh helpers its three scripts build from.

Rebuild the pack with Blender 5.2, in this order:

    blender --background --factory-startup --python tools/blender/create_scenery.py
    blender --background --factory-startup --python tools/blender/create_shipwreck.py
    blender --background --factory-startup --python tools/blender/render_scenery.py

Authoring is Blender's own Z-up and the exporter writes glTF Y-up. Every asset
keeps its origin at substrate level, so `client/js/scenery.js` can stand it on
the sand at y = 0 with no per-asset offset to remember. Nothing here uses a
texture or an image: every surface is a plain Principled colour, which is what
lets the client swap the whole pack over to StandardMaterial the way it already
does for the fish.

The three scripts used to share this code by exec()ing the text of
create_scenery.py up to its `builders=` line. That worked, but renaming one
variable would have broken two other scripts with no warning, so it is a module
they import instead - the same thing create_fish.py does with its detail layers.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB = ROOT / 'client/assets/scenery'   # what ships, beside the fish models
SOURCE = ROOT / 'assets/blender'       # editable sources, beside the fish sources
DOCS = ROOT / 'docs'                   # the review sheet
for path in [GLB, SOURCE, DOCS]: path.mkdir(parents=True, exist_ok=True)
# The whole pack, in the order the review sheet lays it out. create_scenery.py
# builds the first six; the wreck is big enough to have its own script.
SCENERY = ['ribbon-grass', 'broadleaf-plant', 'red-stem-plant', 'branching-driftwood', 'stone-arch', 'weathered-amphora', 'little-shipwreck']
# One seed for the pack, fixed at import. Pebbles, moss cushions and the dents
# in every stone have to land in the same place on every rebuild, or the
# committed .glb files churn without anything having actually changed.
random.seed(23)


def material(name, color):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=.72
    return m

def mesh(name, verts, faces, mat):
    d=bpy.data.meshes.new(name); d.from_pydata(verts,[],faces); d.update()
    o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.data.materials.append(mat)
    for p in d.polygons:p.use_smooth=True
    return o

def tube(name, points, radii, mat, sides=10):
    """A closed ring-swept tube along `points`. Stems, roots, handles and rope
    are all this; the reference vector flips near vertical so the ring never
    collapses on a stem that happens to run straight up."""
    v=[]; f=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        tangent.normalize(); ref=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((1,0,0))
        u=tangent.cross(ref).normalized(); w=tangent.cross(u).normalized()
        for j in range(sides):v.append(Vector(p)+radii[i]*(math.cos(j*math.tau/sides)*u+math.sin(j*math.tau/sides)*w))
    for i in range(len(points)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;f.append((a,b,b+sides,a+sides))
    f.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name,v,f,mat)

def stone(name, p, scale, mat):
    """An ico-sphere with every vertex pushed in or out a little, so pebbles,
    arch stones and moss cushions read as rough rather than moulded."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=p);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(mat)
    for v in o.data.vertices:v.co*=random.uniform(.91,1.09)
    return o

def leaf(name, start, direction, length, width, mat, curl=.25):
    """Solid leaf with a central ridge and a tapered silhouette. Real geometry
    rather than an alpha-cut plane: the pack ships no images, and a transparent
    leaf would need sorting against the glass and the water surface."""
    d=Vector(direction).normalized(); side=d.cross(Vector((0,0,1))).normalized()
    if side.length<.1:side=Vector((1,0,0))
    v=[];f=[];centers=[]
    for i in range(13):
        t=i/12;c=Vector(start)+d*length*t+Vector((0,0,curl*math.sin(t*math.pi)))
        centers.append(c); w=width*(math.sin(math.pi*t)**.8)*.5+.002
        for j in [-1,0,1]:v.append(c+side*w*j+Vector((0,0,.04*math.sin(math.pi*t)*(1-abs(j)))))
    for i in range(12):
        for j in range(2):a=i*3+j;f.append((a,a+1,a+4,a+3))
    o=mesh(name,v,f,mat);mod=o.modifiers.new('Leaf thickness','SOLIDIFY');mod.thickness=.014
    return centers

def clear():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def publish(name):
    """Bake modifiers, gather everything under one root empty named after the
    asset, save the source and export the GLB. Returns the triangle count, which
    the README quotes. The root empty is what the client parents and transforms,
    so it is the one name in the file the runtime depends on."""
    for o in list(bpy.context.scene.objects):
        if o.type!='MESH':continue
        bpy.context.view_layer.objects.active=o;o.select_set(True)
        for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
        o.select_set(False)
    root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for o in meshes:o.parent=root
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
    # export_yup converts Blender's Z-up to glTF's Y-up. Cameras and lights are
    # excluded so the review sheet's studio rig can never leak into a shipped
    # asset - the scene is bare here, but render_scenery.py loads these files.
    bpy.ops.export_scene.gltf(filepath=str(GLB/(name+'.glb')),export_format='GLB',export_yup=True,export_cameras=False,export_lights=False)
    triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    print(f'FISHTANK: {name} exported, {triangles} triangles.')
    return triangles

def studio(names, spread=3.9, rows=4, ortho=17):
    """The review-sheet rig: load each saved source, lay the pack out in a grid
    and point an orthographic camera at it under two area lights. Cycles on the
    CPU, because the GPU path goes through Metal and crashes headless here."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    clear()
    for i,name in enumerate(names):
        with bpy.data.libraries.load(str(SOURCE/(name+'.blend')),link=False) as (src,dst):dst.objects=src.objects
        objs=[o for o in dst.objects if o]
        for o in objs:bpy.context.collection.objects.link(o)
        root=next(o for o in objs if o.parent is None);root.location=((i%3-1)*spread,(i//3)*rows,0)
    bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(material('Backdrop',(.06,.10,.115)))
    bpy.ops.object.camera_add(location=(8,-14,13));cam=bpy.context.object;cam.rotation_euler=(Vector((0,3,.8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=ortho;bpy.context.scene.camera=cam
    for loc,power,size in [((0,-5,10),2200,9),((-6,4,7),1600,7)]:
        bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,2,0))-o.location).to_track_quat('-Z','Y').to_euler()
    s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=24
    s.render.resolution_x=1400;s.render.resolution_y=1000;s.render.resolution_percentage=100
    s.world=bpy.data.worlds.new('Studio world');s.world.color=(.25,.25,.25)
    s.render.filepath=str(DOCS/'scenery-preview.png');bpy.ops.render.render(write_still=True)
    print(f'FISHTANK: review sheet written to {s.render.filepath}')
