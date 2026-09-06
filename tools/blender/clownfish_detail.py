"""Authored detail layers for the clownfish; called by create_fish.py.
Geometry-only detailing keeps the exported assets self-contained and instanced.
"""
import bpy
import math


def enhance(b, root, detail, orange, cream, dark, gold):
    tier = {'standard': 1, 'high': 2, 'hd': 3}[detail]
    # Replace slab fins with rounded, curved silhouettes at every tier above Low.
    for obj in list(root.children):
        if obj.name.startswith(('Dorsal', 'Ventral', 'Pectoral')):
            bpy.data.objects.remove(obj, do_unlink=True)
    amber = b.mat('Clown amber', (.90,.17,.018), .36)
    highlight = b.mat('Clown fin rays', (1,.48,.075), .3)
    scale_mat = b.mat('Clown scale edges', (.87,.20,.035), .32)
    b.fin('Sculpted dorsal', [(0,.39,.69),(.02,.63,.51),(.04,.79,.26),(.025,.84,.01),(0,.78,-.27),(-.01,.69,-.52),(0,.39,-.83)], orange,dark,root,.015)
    b.fin('Sculpted anal', [(0,-.36,.17),(.025,-.64,-.04),(.03,-.76,-.28),(0,-.65,-.58),(0,-.36,-.75)], amber,dark,root,.013)
    # Thin gill-cover rims follow the body surface instead of floating off it.
    for side in [-1,1]:
        def shell(y,z,push=.008):
            x=.43*math.sqrt(max(.001,1-(y/.59)**2-(z/1.06)**2))
            return (side*(x+push),y,z)
        points=[shell(-.30+i*.055,.39+.07*math.sin(i/10*math.pi)) for i in range(11)]
        b.line('Gill opening',points,dark,root,.009)
        b.line('Gill lip',[(x+side*.01,y,z-.023) for x,y,z in points],amber,root,.012)
    b.sphere('Upper lip',(0,-.115,1.032),(.125,.035,.04),orange,root)
    b.sphere('Lower lip',(0,-.174,1.025),(.108,.026,.037),amber,root)
    # Paired fins have their own pivots and flutter together with the tail clip.
    for side in [-1,1]:
        pivot=bpy.data.objects.new('PectoralPivot',None);bpy.context.collection.objects.link(pivot);pivot.parent=root
        points=[(side*.34,-.10,.35),(side*.59,-.14,.23),(side*.79,-.21,.02),(side*.76,-.29,-.14),(side*.58,-.30,-.27),(side*.35,-.16,-.10)]
        b.fin('Curved pectoral',points,orange,dark,pivot,.01)
        if tier>=2:
            for i in range(5):
                end=(side*(.70-.035*i),-.17-.028*i,.14-.085*i)
                b.line('Pectoral ray',[(side*.37,-.10,.29),(side*.54,-.14,.16-i*.04),end],highlight,pivot,.007)
        obj=b.merge_parts(pivot,'PectoralMesh')
        pivot.location=b.vec((side*.34,-.1,.35));obj.location=-pivot.location
        if tier>=2:
            for frame,angle in [(1,0),(7,.24*side),(13,0),(19,-.16*side),(25,0)]:
                pivot.rotation_euler.y=angle;pivot.keyframe_insert(data_path='rotation_euler',index=1,frame=frame)
            pivot.animation_data.action.name='swim'
    if tier>=2:
        for i in range(9 if tier==3 else 6):
            z=.47-i*(.13 if tier==3 else .20)
            y=.76-.19*abs(z)
            b.line('Dorsal fin ray',[(.026,.42,z+.04),(.037,.58,z),(.034,y,z-.055)],highlight,root,.007 if tier==3 else .010)
        for i in range(5):
            b.line('Anal fin ray',[(.025,-.40,-.04-i*.10),(.042,-.60,-.15-i*.085),(.03,-.69,-.25-i*.063)],highlight,root,.007)
        # Staggered arcs wrap the ellipsoid; avoid white bands and the face.
        rows,cols=(18,26) if tier==3 else (10,16)
        for row in range(rows):
            z=-.89+row*1.43/(rows-1)
            if min(abs(z-.69),abs(z+.04),abs(z+.72))<.16:continue
            for col in range(cols):
                angle=(col+(row%2)*.5)*2*math.pi/cols
                if abs(math.cos(angle))<.20:continue
                points=[]
                for j in range(7):
                    t=-math.pi/2+j*math.pi/6
                    zz=z+( .035 if tier==3 else .055)*math.cos(t)
                    a=angle+t*(.067 if tier==3 else .105)
                    r=math.sqrt(max(.001,1-(zz/1.06)**2))
                    points.append(((.43*r+.003)*math.cos(a),(.59*r+.003)*math.sin(a),zz))
                b.line('Scale arc',points,scale_mat,root,.0028 if tier==3 else .004)
    if tier==3:
        # Iris spokes sit just outside the existing iris shell; eye surfaces are glossy.
        for side in [-1,1]:
            for i in range(16):
                a=i*2*math.pi/16
                b.line('Iris filament',[(side*.516,.175+.065*math.sin(a),.803+.06*math.cos(a)),(side*.514,.175+.105*math.sin(a),.803+.09*math.cos(a))],gold,root,.0025)
            for i in range(3):
                b.line('Gill crease',[(side*.421,-.09+i*.07,.30),(side*.428,-.12+i*.07,.25)],amber,root,.005)
        for name in ['Ink','Pearl','Honey']:
            material=bpy.data.materials.get(name)
            material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.18
    return highlight


def tail(b, parent, detail, orange, cream, dark, highlight):
    tier={'standard':1,'high':2,'hd':3}[detail]
    count=12 if tier==1 else 24 if tier==2 else 40
    outline=[]
    for i in range(count+1):
        a=.92-i*1.84/count
        r=.83+(.018 if tier==1 else .042)*math.cos(a*(16 if tier==3 else 10))
        outline.append((.035*math.sin(a*2),r*math.sin(a),-.86-r*math.cos(a)))
    b.fin('Rounded fan',[(0,.095,-.86)]+outline+[(0,-.095,-.86)],orange,dark,parent,.009)
    if tier>=2:
        b.line('Pearl fin border',[(x+.014,y*.95,-.86+(z+.86)*.95) for x,y,z in outline],cream,parent,.012 if tier==2 else .009)
    for i in range(5 if tier==1 else 9 if tier==2 else 15):
        a=-.84+i*1.68/(4 if tier==1 else 8 if tier==2 else 14)
        pts=[(.019,0,-.88),(.04,.43*math.sin(a),-.86-.43*math.cos(a)),(.035*math.sin(a*2)+.018,.77*math.sin(a),-.86-.77*math.cos(a))]
        b.line('Tail ray',pts,highlight,parent,.010 if tier==1 else .006)
