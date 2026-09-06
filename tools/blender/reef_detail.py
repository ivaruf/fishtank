"""Four-tier blue tang and pufferfish detailing; shares the existing exporter."""
import bpy
import math


def enhance(b, root, kind, detail, cream, dark, gold, blue, mint):
    tier={'standard':1,'high':2,'hd':3}[detail]
    tang=kind=='blue-tang'
    skin=blue if tang else mint
    rays=b.mat('Reef fin rays',(.26,.65,.96) if tang else (1,.72,.21),.28)
    edge=b.mat('Reef detail',(.012,.11,.32) if tang else (.13,.39,.20),.35)
    # Replace rigid side fins with curved lobes at their own swim pivots.
    for obj in list(root.children):
        if obj.name.startswith(('Pectoral','Little flipper')):bpy.data.objects.remove(obj,do_unlink=True)
    w=.27 if tang else .66
    for side in [-1,1]:
        pivot=bpy.data.objects.new('FlipperPivot',None);bpy.context.collection.objects.link(pivot);pivot.parent=root
        points=[(side*w,-.08,.23),(side*(w+.24),-.08,.12),(side*(w+.36),-.16,-.08),(side*(w+.28),-.30,-.25),(side*w,-.24,-.08)]
        b.fin('Rounded flipper',points,gold,edge,pivot,.011)
        if tier>=2:
            for i in range(6 if tier==3 else 4):
                b.line('Flipper ray',[(side*(w+.015),-.11,.19),(side*(w+.17),-.12-i*.018,.08-i*.034),(side*(w+.29-i*.015),-.13-i*.024,-.025-i*.031)],rays,pivot,.006)
        obj=b.merge_parts(pivot,'FlipperMesh');pivot.location=b.vec((side*w,-.08,.23));obj.location=-pivot.location
        if tier>=2:
            for f,a in [(1,0),(7,.26*side),(13,0),(19,-.20*side),(25,0)]:
                pivot.rotation_euler.y=a;pivot.keyframe_insert(data_path='rotation_euler',index=1,frame=f)
            pivot.animation_data.action.name='swim'
    if tang:
        for obj in list(root.children):
            if obj.name.startswith(('Sail dorsal','Sail ventral')):bpy.data.objects.remove(obj,do_unlink=True)
        for sign in [-1,1]:
            points=[(0,sign*.38,.63),(.01,sign*.70,.40),(.02,sign*.88,.06),(.01,sign*.86,-.22),(0,sign*.66,-.60),(0,sign*.21,-.94)]
            b.fin('Swept sail',points,blue,dark,root,.013)
            if tier>=2:
                for side in [-1,1]:
                    for i in range(10 if tier==3 else 6):
                        z=.36-i*(.09 if tier==3 else .15)
                        b.line('Sail ray',[(side*.027,sign*.44,z), (side*.035,sign*.55,z-.06),(side*.028,sign*(.70-.22*abs(z)),z-.12)],rays,root,.0055)
        for side in [-1,1]:
            b.line('Gill cover',[(side*.28,.21,.43),(side*.31,.08,.43),(side*.30,-.12,.38),(side*.28,-.23,.30)],edge,root,.010)
        b.sphere('Sculpted lip',(0,-.085,1.015),(.094,.035,.035),blue,root)
        if tier>=2:
            # Fine scale arcs live on the exposed blue front and lower flank.
            for row in range(12 if tier==3 else 7):
                z=-.67+row*(1.12/(11 if tier==3 else 6))
                for side in [-1,1]:
                    for j in range(5):
                        a=-.95+j*.18
                        pts=[]
                        for k in range(6):
                            t=-math.pi/2+k*math.pi/5;zz=z+.035*math.cos(t);aa=a+.065*math.sin(t)
                            r=math.sqrt(max(.001,1-(zz/1.02)**2))
                            pts.append((side*(.31*r+.004)*math.cos(aa),(.66*r+.004)*math.sin(aa),zz))
                        b.line('Blue scales',pts,rays,root,.0028 if tier==3 else .0038)
    else:
        # The puffer gets a plated belly and soft tapered spines, not fish scales.
        b.sphere('Upper muzzle',(0,.035,.90),(.17,.07,.07),cream,root)
        for side in [-1,1]:
            b.line('Gill crescent',[(side*.66,.19,.42),(side*.72,.04,.38),(side*.68,-.14,.40)],edge,root,.012)
        for i in range(3 if tier==1 else 5):
            y=-.30-i*.075
            points=[]
            for j in range(13):
                x=-.43+j*.86/12
                z=.90*math.sqrt(max(.001,1-(x/.77)**2-(y/.77)**2))+.009
                points.append((x,y,z))
            b.line('Belly ridge',points,cream,root,.008)
        if tier>=2:
            for obj in list(root.children):
                if obj.name.startswith('Soft spine'):bpy.data.objects.remove(obj,do_unlink=True)
            count=68 if tier==3 else 30
            for i in range(count):
                a=i*2.39996;z=-.69+(i%13)*.105;r=math.sqrt(max(.001,1-(z/.9)**2))
                center=(.775*r*math.cos(a),.775*r*math.sin(a),z)
                if center[1]<-.2 or (z>.46 and center[1]>.10):continue
                n=b.vec(center).normalized();p=b.vec(center)
                # A compact ring base tapers into a small cream point.
                u=n.cross(b.vec((0,1,0))).normalized();v=n.cross(u)
                if u.length<.1:continue
                ring=[p+(u*math.cos(k*math.pi/4)+v*math.sin(k*math.pi/4))*.037 for k in range(8)]
                verts=[(q.x,q.z,-q.y) for q in ring]
                tip=p+n*(.095 if tier==3 else .075);verts.append((tip.x,tip.z,-tip.y))
                obj=b.mesh('Soft tapered spine',verts,[(k,(k+1)%8,8) for k in range(8)],cream,root)
                for poly in obj.data.polygons:poly.use_smooth=True
        if tier==3:
            for side in [-1,1]:
                for i in range(12):
                    y=.05+(i%4)*.105;z=-.52+(i//4)*.19
                    x=.777*math.sqrt(max(.01,1-(y/.77)**2-(z/.9)**2))
                    b.sphere('Tiny freckle',(side*x,y,z),(.021,.025,.025),edge,root,*b.LEVEL['tiny'])
    if tier==3:
        # Smaller limbal accents and a second highlight add eye depth.
        width,y,z=(.235,.23,.70) if tang else (.39,.27,.67)
        for side in [-1,1]:
            b.sphere('Secondary eye sparkle',(side*(width+.214),y-.022,z+.123),(.012,.018,.016),cream,root,*b.LEVEL['small'])
        for name in ['Pearl','Ink','Honey']:
            bpy.data.materials[name].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.17
    return rays


def tail(b,parent,kind,detail,base,edge,rays):
    tier={'standard':1,'high':2,'hd':3}[detail]
    h=.54 if kind=='blue-tang' else .34
    outline=[]
    for i in range(19 if tier==3 else 11):
        count=18 if tier==3 else 10;a=.92-i*1.84/count
        radius=.76+(.035 if tier>=2 else .012)*math.cos(a*12)
        outline.append((.022*math.sin(a*2),h*math.sin(a),-.85-radius*math.cos(a)))
    b.fin('Sculpted caudal',[(0,.09,-.85)]+outline+[(0,-.09,-.85)],base,edge,parent,.011)
    count=5 if tier==1 else 9 if tier==2 else 15
    for side in [-1,1]:
        for i in range(count):
            a=-.84+i*1.68/(count-1)
            b.line('Caudal ray',[(side*.018,0,-.90),(side*.025,.4*h*math.sin(a),-1.14),(.022*math.sin(a*2)+side*.022,.92*h*math.sin(a),-.85-.69*math.cos(a))],rays,parent,.006)
        if tier>=2:b.line('Fin edge',[(x+side*.015,y*.97,z+.014) for x,y,z in outline],edge,parent,.010)
