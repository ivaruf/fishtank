"""Build the authored sand floor: one seamless 8 x 8 tile, at two densities.

    blender --background --factory-startup --python tools/blender/create_sand.py

The tank floor is 72 x 72 units, so nine tiles across cover it exactly with no
rotation and no per-tile fitting - which only works because the tile is
periodic. Both the ripple heights and the textures wrap: the elevation uses
whole-number frequencies so opposite edges have identical heights *and* slopes,
the noise is filtered with np.roll so the filter wraps too, and vertex normals
are set analytically rather than averaged from faces, because an averaged
normal at the tile edge knows nothing about the neighbour and shows up as a
lit seam under grazing light. docs/sand-preview.png is four adjacent tiles,
which is the render to check after any change in here.

Unlike the rest of the packs this one carries real images: a base colour and a
grain normal map, 1024 square, both generated in numpy and both packed into the
.blend and embedded in the .glb, so nothing is fetched alongside the model. The
PNGs are written beside the sources as well, purely so a human can look at
them. The normal map is saved as Non-Color data and the client has to keep it
that way; see client/js/sand.js.

Tiers are `high` (2,048 triangles a tile) and `ultra` (8,192), loaded by the
top two quality settings only - at nine by nine that is 166k and 663k triangles
of floor, which is why Battery saver and Balanced keep the flat procedural sand.
"""
import bpy
import math
from pathlib import Path
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB = ROOT / 'client/assets/sand'      # what ships
SOURCE = ROOT / 'assets/blender/sand'  # editable sources and the loose PNGs
DOCS = ROOT / 'docs'                   # the four-tile seam check
for path in [GLB, SOURCE, DOCS]: path.mkdir(parents=True, exist_ok=True)
# Fixed, so a rebuild does not churn four megabytes of embedded PNG for nothing.
rng=np.random.default_rng(314)
N=1024
y,x=np.mgrid[0:N,0:N]/N
# Periodic color variation and fine grains; all filtering wraps at tile edges.
grain=rng.random((N,N)).astype(np.float32)
soft=sum(np.roll(np.roll(grain,i,0),j,1) for i,j in [(0,0),(1,0),(-1,0),(0,1),(0,-1)])/5
cloud=.5+.18*np.sin(2*np.pi*x)*np.cos(2*np.pi*y)+.13*np.cos(4*np.pi*y+np.sin(2*np.pi*x))
# White tropical sand: near-white with a faint warm cast. The mottling is kept
# shallow on purpose - contrast that reads as character on a brown seabed reads
# as dirt on a white beach - and the dark flecks are shell grit rather than the
# heavy speckle a warmer sand can carry. Values stay under 1.0 because these
# are linear floats on their way to an 8-bit sRGB PNG, which would clip.
# The cast is warmer than white sand looks in daylight, deliberately: the tank
# lights it with a blue-white hood lamp through green water, which takes the
# warmth straight back out again.
speck=np.where(grain>.986,-.13,np.where(grain<.024,.09,0))
shade=.72+.10*cloud+.14*(soft-.5)+speck
rgb=np.stack([shade,shade*.94,shade*.83],axis=-1)
height=.55*soft+.45*grain
dx=(np.roll(height,-1,1)-np.roll(height,1,1))*.30
dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.30
normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True);normal=normal*.5+.5

def image(name,arr,linear=False):
 im=bpy.data.images.new(name,width=N,height=N,alpha=True)
 if linear:im.colorspace_settings.name='Non-Color'
 rgba=np.concatenate([arr,np.ones((N,N,1))],axis=-1).astype(np.float32);im.pixels.foreach_set(rgba.ravel());im.update();im.filepath_raw=str(SOURCE/(name+'.png'));im.file_format='PNG';im.save();im.pack();return im
bpy.ops.wm.read_factory_settings(use_empty=True)
color=image('sand-basecolor',rgb);norm=image('sand-normal',normal,True)
m=bpy.data.materials.new('White coral sand');m.use_nodes=True
bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.94
tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=color;tex.extension='REPEAT';m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
texn=m.node_tree.nodes.new('ShaderNodeTexImage');texn.image=norm;texn.extension='REPEAT';n=m.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.65;m.node_tree.links.new(texn.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],bs.inputs['Normal'])
def elevation(u,v):
 # Whole-number frequencies keep opposite edges (and slopes) identical.
 phase=2*math.pi*(v*5+.12*math.sin(2*math.pi*u))
 return .035*math.sin(phase)+.009*math.sin(phase*2)+.013*math.sin(2*math.pi*u)*math.cos(2*math.pi*v)
for tier,steps in [('high',32),('ultra',64)]:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 verts=[(-4+8*i/steps,-4+8*j/steps,elevation(i/steps,j/steps)) for j in range(steps+1) for i in range(steps+1)]
 faces=[]
 for j in range(steps):
  for i in range(steps):a=j*(steps+1)+i;faces.append((a,a+1,a+steps+2,a+steps+1))
 d=bpy.data.meshes.new('Rippled sand surface');d.from_pydata(verts,[],faces);d.update();uv=d.uv_layers.new(name='Sand UV')
 for p in d.polygons:
  p.use_smooth=True
  for li in p.loop_indices:
   v=d.vertices[d.loops[li].vertex_index].co;uv.data[li].uv=((v.x+4)/8,(v.y+4)/8)
 o=bpy.data.objects.new('sand-tile-'+tier,d);bpy.context.collection.objects.link(o);d.materials.append(m)
 # Analytic periodic normals also remove lighting seams between adjacent tiles.
 normals=[];eps=.00001
 for j in range(steps+1):
  for i in range(steps+1):
   u=i/steps;v=j/steps;du=(elevation(u+eps,v)-elevation(u-eps,v))/(16*eps);dv=(elevation(u,v+eps)-elevation(u,v-eps))/(16*eps);nrm=Vector((-du,-dv,1)).normalized();normals.append(nrm)
 d.normals_split_custom_set_from_vertices(normals)
 bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('sand-tile-'+tier+'.blend')))
 # No cameras or lights: the seam-check rig below must not reach the exports.
 bpy.ops.export_scene.gltf(filepath=str(GLB/('sand-tile-'+tier+'.glb')),export_format='GLB',export_yup=True,export_cameras=False,export_lights=False)
 print(f'FISHTANK: sand-tile-{tier} exported, {len(faces)*2} triangles, 8 x 8 units.')
# A four-tile render checks repetition and the seams under grazing light.
for px,py in [(8,0),(0,8),(8,8)]:
 clone=o.copy();clone.data=o.data;bpy.context.collection.objects.link(clone);clone.location=(px,py,0)
bpy.ops.object.camera_add(location=(13,-10,12));cam=bpy.context.object;cam.rotation_euler=(Vector((3,3,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=21;bpy.context.scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(-5,-4,5));light=bpy.context.object;light.data.energy=1700;light.data.size=7;light.rotation_euler=(Vector((3,3,0))-light.location).to_track_quat('-Z','Y').to_euler()
s=bpy.context.scene;s.world=bpy.data.worlds.new('Studio');s.world.color=(.25,.25,.25);s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=24;s.render.resolution_x=1200;s.render.resolution_y=900;s.render.resolution_percentage=100;s.render.filepath=str(DOCS/'sand-preview.png');bpy.ops.render.render(write_still=True)
print(f'FISHTANK: seam check written to {s.render.filepath}')
