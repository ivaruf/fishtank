"""Authored High/Ultra office and zapper detail layers. Run Blender headlessly.
Coordinates match world.js (Y up); exported GLBs use Y up. Base scene remains in JS.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'client/assets/environment';SOURCE=ROOT/'assets/blender/environment'
if not (ROOT/'client').exists(): OUT=SOURCE=Path(__file__).resolve().parent
OUT.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
def vec(p):return Vector((p[0],-p[2],p[1]))
def mat(n,c,metal=0):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.48;p.inputs['Metallic'].default_value=metal;return m
def box(n,p,s,m,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=vec(p));o=bpy.context.object;o.name=n;o.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:
  mod=o.modifiers.new('Rounded edges','BEVEL');mod.width=bevel;mod.segments=3 if ultra else 2;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def tube(n,pts,r,m):
 c=bpy.data.curves.new(n,'CURVE');c.dimensions='3D';c.resolution_u=2;c.bevel_depth=r;c.bevel_resolution=2 if ultra else 1;s=c.splines.new('POLY');s.points.add(len(pts)-1)
 for v,p in zip(s.points,pts):v.co=(*vec(p),1)
 o=bpy.data.objects.new(n,c);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def ring(n,p,r,t,m,plane='xz'):
 pts=[]
 for i in range(33 if ultra else 21):
  a=i*math.tau/(32 if ultra else 20);d=(r*math.cos(a),0,r*math.sin(a)) if plane=='xz' else (r*math.cos(a),r*math.sin(a),0)
  pts.append(tuple(p[j]+d[j] for j in range(3)))
 return tube(n,pts,t,m)
def ball(n,p,s,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16 if ultra else 12,ring_count=8,location=vec(p));o=bpy.context.object;o.name=n;o.scale=(s[0],s[2],s[1]);o.data.materials.append(m)
 for f in o.data.polygons:f.use_smooth=True
 return o
def plant(p,scale=1):
 x,y,z=p;box('Ceramic planter',(x,y+3*scale,z),(7*scale,6*scale,7*scale),ceramic,.6*scale)
 for i in range(9 if ultra else 6):
  a=i*2.4;h=(8+i%3*2)*scale;end=(x+math.cos(a)*4*scale,y+6*scale+h,z+math.sin(a)*4*scale)
  tube('Plant stem',[(x,y+6*scale,z),end],.12*scale,leaf)
  o=ball('Sculpted leaf',end,(2.1*scale,4.2*scale,.75*scale),leaf);o.rotation_euler[1]=a

def office():
 # Detailed monitor face sits on the room's existing screen, facing into tank.
 box('Screen dark editor',(136.2,14,60),(.25,20,38),screen,.15)
 box('Screen sidebar',(136,14,74),(.2,18,7),teal)
 for i in range(10):
  box('Editor line',(135.85,21-i*1.5,58+(i%3)*2),(.15,.45,12+(i%4)*2),cyan if i%3 else cream)
 for i in range(4):box('Sidebar icon',(135.8,20-i*3,74),(.1,1.2,1.8),cyan)
 # Individual keys, not a single flat keyboard block.
 for row in range(5):
  for col in range(13):box('Keyboard key',(114+row*1.7,-.62,46+col*2.25),(1.3,.5,1.8),silver,.13)
 box('Keyboard spacebar',(122,-.6,60),(1.2,.5,10),silver,.12)
 box('Desk drawer',(123,-12,96),(42,13,21),wood,.7)
 tube('Drawer pull',[(111,-12,84.7),(111,-12,83.8),(123,-12,83.8),(123,-12,84.7)],.5,silver)
 # Coffee rim, handle, coaster and a small desk notebook.
 ring('Mug lip',(110,5.5,92),3,.3,ceramic);ring('Mug handle',(106.6,1.7,92),2,.55,ceramic,'xy')
 box('Coaster',(110,-2.35,92),(8,.25,8),wood,.6)
 box('Notebook',(115,-1.8,26),(14,.7,17),teal,.3)
 for i in range(6):box('Notebook page edges',(115,-1.9+i*.08,26),(13.8,.025,16.8),cream)
 tube('Desk cable',[(138,-1,60),(143,-7,66),(142,-25,68),(132,-39,72),(109,-39,85)],.35,dark)
 # Raised chair upholstery channels and armrests.
 for z in range(49,73,4):box('Chair back channel',(75.8,2,z),(1.2,27,2.7),teal,.6)
 for z in [43,77]:
  box('Padded armrest',(88,-4,z),(21,2.5,4),dark,1)
  tube('Armrest bracket',[(82,-14,z),(82,-5,z),(95,-5,z)],.7,silver)
 for i in range(5):
  a=i*math.tau/5;end=(88+math.cos(a)*16,-37,60+math.sin(a)*16)
  tube('Chair star base',[(88,-28,60),end],1,silver);ball('Caster wheel',(end[0],-38,end[2]),(2,2,1.3),dark)
 # Extra objects on bookcase top are visible above existing books.
 plant((-135,71,-35),1.2)
 for i in range(4):box('Stacked folio',(-136,72+i*2,-74),(17,1.8,26),[teal,wood,cream,coral][i],.2)
 box('Storage box',(-136,78,-94),(16,13,10),cream,.5);box('Box label',(-127.8,78,-94),(.2,3,5),dark)
 # Warm shelves on front wall, with framed artwork and keepsakes.
 for y in [0,28]:
  box('Floating display shelf',(57,y,-190),(85,2.5,16),wood,.5)
  for i in range(7):box('Display volume',(24+i*5,y+8,-190),(3.4,14+i%3*2,9),[teal,cream,coral][i%3],.2)
 plant((82,2,-190),1.1)
 box('Artwork frame',(65,55,-197),(52,39,2),wood,.6);box('Artwork canvas',(65,55,-195.7),(48,35,.3),cream)
 for i in range(5):box('Abstract art stroke',(51+i*7,51+(i%3)*4,-195.4),(4,14+i*2,.2),[teal,coral,cyan][i%3],.2)
 # Window: bright skyline pinpoints and slim mullions.
 for x in [-10,50]:box('Window mullion',(x,45,194),(1.6,58,2),silver,.3)
 for i in range(18):box('Distant window light',(-33+i*6,24+i%4*2,198.1),(1.2,.8,.15),cyan if i%3 else cream)
 if not ultra:return
 # Ultra adds layered curtains, floor seams, desk microdetail and framed charts.
 for side in [-1,1]:
  for i in range(8):
   x=(-53-i*2) if side<0 else (93+i*2)
   box('Curtain fold',(x,38,190+(i%2)*1.5),(2.8,84,3.5),teal,.9)
 for z in range(-180,200,14):box('Floorboard seam',(0,-39.84,z),(290,.035,.15),wood)
 for x in range(-140,150,24):
  for z in range(-180,200,28):box('Staggered board end',(x,-39.82,z+(x%3)*4),(.12,.035,14),wood)
 for i in range(6):
  ring('Notebook binding',(109,-1.3,20+i*2),.5,.10,silver,'xy')
 for i in range(8):box('Paper text',(120,-2.02,15+i*.7),(7-i%3,.06,.16),dark)
 for z in [-45,-112]:
  box('Detailed frame',(148.4,60,z),(1,27,33),wood,.4)
  box('Print paper',(147.7,60,z),(.2,24,30),cream)
  for i in range(6):box('Print bar',(147.5,54+i*2,z+4-i),(.15,1,10+i*2),teal if i%2 else coral)
 # Hanging pendant with warm diffuser above the near side of the room.
 tube('Pendant cord',[(15,109,-95),(15,75,-95)],.3,dark)
 ball('Pendant housing',(15,72,-95),(12,5,12),wood);ball('Pendant diffuser',(15,70,-95),(10,.7,10),cream)

def zapper():
 # Local coordinates; the runtime places this at FILTER.x / FILTER.z.
 box('Rounded canister casing',(0,12,0),(5.12,23.8,4.12),dark,.28)
 box('Brushed service panel',(0,14,-2.18),(4.25,11,.24),silver,.18)
 for i in range(7):box('Intake grille recess',(0,9+i*1.55,-2.34),(3.4,.45,.2),dark,.1)
 for x in [-1.85,1.85]:
  for y in [8.9,19.1]:ball('Panel screw',(x,y,-2.44),(.14,.14,.07),silver)
 box('Control surround',(0,4,-2.12),(4.8,5.7,.25),dark,.35)
 # Outline around existing active button, preserving its interaction target.
 ring('Button metal bezel',(0,4,-2.48),1.85,.14,silver,'xy')
 box('Warning plate',(.7,22,-2.17),(2.3,1.25,.2),yellow,.10)
 for i in range(4):
  o=box('Hazard stripe',(-.12+i*.5,22,-2.30),(.18,1,.025),dark);o.rotation_euler[1]=-.38
 for x in [-2.62,2.62]:
  for y in [1,23]:box('Housing clamp',(x,y,0),(.24,1,3.8),silver,.08)
 tube('Intake union',[(2,22,0),(3.4,22,0),(3.4,20,-.6)],.72,dark)
 for y in [2,7,20]:ring('Pipe coupling',(3.4,y,-.6),.72,.15,silver)
 tube('Power cable',[(-2,23,1),(-3,25,1.5),(-3.6,29,1.6),(-3.6,32,2)],.17,dark)
 if not ultra:return
 for i in range(16):ring('Flexible hose rib',(-3.6,25+i*.4,1.6),.23,.065,silver)
 for side in [-1,1]:
  for i in range(10):box('Cooling fin',(side*2.66,11+i*.8,.2),(.25,.22,3.25),silver,.06)
 for y in [1.2,23]:
  for x in [-2,2]:box('Latch clip',(x,y,-2.4),(.36,.7,.3),silver,.07)
 box('Serial plate',(0,6.9,-2.30),(2.4,.75,.05),silver)
 for i in range(13):box('Serial engraving',(-.95+i*.15,6.9,-2.34),(.055,.45,.025),dark)
 ring('Outlet coupling',(1.5,26.5,-5),.58,.10,silver,'xy')

report=[]
for ultra in [False,True]:
 for name,build in [('office',office),('zapper',zapper)]:
  bpy.ops.wm.read_factory_settings(use_empty=True)
  dark=mat('Graphite',(.065,.083,.10));wood=mat('Walnut',(.30,.16,.08));silver=mat('Satin metal',(.44,.51,.53),.5);cream=mat('Ivory',(.81,.74,.56));teal=mat('Petrol teal',(.035,.25,.26));coral=mat('Burnt orange',(.64,.19,.09));cyan=mat('Screen cyan',(.20,.67,.74));screen=mat('Editor ink',(.015,.045,.06));leaf=mat('Plant green',(.12,.35,.16));ceramic=mat('Glazed clay',(.58,.22,.11));yellow=mat('Warning amber',(.95,.64,.055))
  build()
  # Batch by material so hundreds of details become a handful of draw calls.
  for o in list(bpy.context.scene.objects):
   bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
   if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
  for m in list(bpy.data.materials):
   objs=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==m]
   if not objs:continue
   bpy.ops.object.select_all(action='DESELECT')
   for o in objs:o.select_set(True)
   bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();objs[0].name=name+' '+m.name
  stem=name+('-ultra' if ultra else '-high')
  bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(stem+'.blend')))
  bpy.ops.export_scene.gltf(filepath=str(OUT/(stem+'.glb')),export_format='GLB')
  report.append({'asset':stem,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')})
(OUT/'manifest.json').write_text(json.dumps(report,indent=2))
