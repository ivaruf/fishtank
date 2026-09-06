"""Four-tier detail for the patterned reef disc fish: butterflyfish, wrasse, royal gramma, triggerfish.
Their markings are projected onto the body ellipsoid instead of floating off it as spheres or slabs.
"""
import bpy
import math

# Body semi-axes from create_fish.build(), and optional reshaping of that ellipsoid.
DIMS={'butterflyfish':(.25,.66,.89),'wrasse':(.30,.36,1.12),'royal-gramma':(.31,.42,1.02),'triggerfish':(.34,.56,.96)}
def _wrasse_shape(u,R):
    s=R**(1.05*max(0.,u)**2)                       # conical snout
    return s,s*(1+.24*math.exp(-(u/.55)**2))       # fusiform depth through the middle
def _pinch(k):                                     # narrows the caudal peduncle
    def f(u,R):
        t=1-k*max(0.,-u-.40);return t,t
    return f
SHAPE={'wrasse':_wrasse_shape,'triggerfish':_pinch(.80),'royal-gramma':_pinch(.45)}
# Caudal shape: ('fan', z0, half height, reach, scallop, waves) or ('fork', z0, h, notch, lobe, power).
TAIL={'butterflyfish':('fan',-.80,.41,.60,.045,8),'royal-gramma':('fan',-.90,.45,.62,.040,7),
      'triggerfish':('fan',-.86,.53,.63,.050,6),'wrasse':('fork',-.96,.48,.30,.42,1.5)}


def radii(dims,z,shape=None):
    w,h,l=dims;R=math.sqrt(max(.0004,1-(z/l)**2))
    fx,fy=shape(z/l,R) if shape else (1.,1.)
    return w*R*fx,h*R*fy

def ring(dims,z,a,push=0.,shape=None):
    rx,ry=radii(dims,z,shape);return (rx+push)*math.cos(a),(ry+push)*math.sin(a)

def drop(root,prefixes):
    for obj in list(root.children):
        if obj.name.startswith(prefixes):bpy.data.objects.remove(obj,do_unlink=True)

def reshape(root,dims,shape):
    # Squeeze the already-built body in place so its material bands ride along.
    if not shape:return
    w,h,l=dims
    for obj in root.children:
        if obj.name!='Body':continue
        for v in obj.data.vertices:
            fx,fy=shape(-v.co.y/l,math.hypot(v.co.x/w,v.co.z/h))
            v.co.x*=fx;v.co.z*=fy
        obj.data.update()

def patch(b,name,root,dims,side,center,extent,material,push=.009,segs=12,shape=None):
    # A marking lying in the skin: concentric rings swept through (angle, z) surface space.
    # Wide patches need the radial steps or their chords cut back inside the body.
    a0,z0=center;ra,rz=extent;steps=max(2,min(6,int(ra/.22)+1))
    def P(a,z):
        x,y=ring(dims,z,a,push,shape);return (side*x,y,z)
    verts=[P(a0,z0)];faces=[(0,1+i,1+(i+1)%segs) for i in range(segs)]
    for s in range(1,steps+1):
        f=s/steps
        verts+=[P(a0+ra*f*math.cos(2*math.pi*i/segs),z0+rz*f*math.sin(2*math.pi*i/segs)) for i in range(segs)]
    for s in range(steps-1):
        k=1+s*segs
        faces+=[(k+i,k+segs+i,k+segs+(i+1)%segs,k+(i+1)%segs) for i in range(segs)]
    obj=b.mesh(name,verts,faces,material,root)
    for p in obj.data.polygons:p.use_smooth=True
    return obj

def stripe(b,name,root,dims,side,samples,material,width=.008,push=.006,shape=None,steps=4):
    # Resampled in surface space: straight chords between distant samples sink into the body.
    pts=[]
    for i in range(len(samples)-1):
        (a0,z0),(a1,z1)=samples[i],samples[i+1]
        for k in range(steps):
            f=k/steps;z=z0+(z1-z0)*f;x,y=ring(dims,z,a0+(a1-a0)*f,push,shape);pts.append((side*x,y,z))
    a,z=samples[-1];x,y=ring(dims,z,a,push,shape);pts.append((side*x,y,z))
    return b.line(name,pts,material,root,width)

def scales(b,root,dims,material,tier,span,angles,skip=None,shape=None,width=None,stagger=0.,size=None,rows=None):
    rows=rows or (16 if tier==3 else 9)
    dz,da=size or ((.038,.062) if tier==3 else (.058,.092))
    for row in range(rows):
        z=span[0]+row*(span[1]-span[0])/(rows-1)
        for side in [-1,1]:
            for a0 in [a+(row%2)*stagger for a in angles]:
                if skip and skip(z,a0):continue
                pts=[]
                for k in range(6):
                    t=-math.pi/2+k*math.pi/5
                    zz=z+dz*math.cos(t);aa=a0+da*math.sin(t)
                    x,y=ring(dims,zz,aa,.0035,shape);pts.append((side*x,y,zz))
                b.line('Scale arc',pts,material,root,width or (.0026 if tier==3 else .0036))

def tube(b,name,parent,material,path,rads,segs=12,axis='z'):
    # Smooth tapered cone; rings run perpendicular to `axis` and the last point is the tip.
    verts=[];faces=[];n=len(path)
    for (x,y,z),r in zip(path,rads):
        for k in range(segs):
            a=2*math.pi*k/segs;c,s=r*math.cos(a),r*math.sin(a)
            verts.append((x+c,y+s,z) if axis=='z' else (x+c,y,z+s))
    for i in range(n-1):
        for k in range(segs):
            faces.append((i*segs+k,i*segs+(k+1)%segs,(i+1)*segs+(k+1)%segs,(i+1)*segs+k))
    tip=len(verts);verts.append(path[-1])
    faces+=[((n-1)*segs+k,(n-1)*segs+(k+1)%segs,tip) for k in range(segs)]
    faces.append(tuple(range(segs-1,-1,-1)))
    obj=b.mesh(name,verts,faces,material,parent)
    for p in obj.data.polygons:p.use_smooth=True
    return obj

def sail(b,name,root,dims,zs,hf,material,edge,raymat,tier,sign=1,thick=.020,shape=None,wave=.022,waves=6):
    # A median fin whose base follows the body outline and whose free edge is scalloped.
    n=(12,20,32)[tier-1];outer=[];inner=[]
    for i in range(n+1):
        t=i/n;z=zs[0]+(zs[1]-zs[0])*t;ry=radii(dims,z,shape)[1]
        crest=hf(t)+(wave*math.sin(t*waves*2*math.pi) if tier>=2 else 0)
        outer.append((.010*math.sin(t*5),sign*(ry-.03+crest),z));inner.append((0,sign*max(.03,ry-.06),z))
    b.fin(name,outer+inner[::-1],material,edge,root,thick)
    if tier>=2:
        for i in range(6 if tier==2 else 11):
            t=(i+.5)/(6 if tier==2 else 11);z=zs[0]+(zs[1]-zs[0])*t;ry=radii(dims,z,shape)[1];h=hf(t)
            for s in [-1,1]:
                b.line(name+' ray',[(s*(thick+.004),sign*(ry-.02),z),(s*(thick+.006),sign*(ry+h*.42),z-.012),
                                    (s*(thick+.005),sign*(ry-.03+h*.88),z-.03)],raymat,root,.0055)

def along(points,t):
    seg=t*(len(points)-1);i=min(int(seg),len(points)-2);f=seg-i
    return tuple(points[i][k]+(points[i+1][k]-points[i][k])*f for k in range(3))

def pectorals(b,root,tier,points,material,edge,raymat,swing=.28,thick=.011):
    # Paired fins ride their own pivots so the swim clip gets three animated parts.
    for side in [-1,1]:
        pivot=bpy.data.objects.new('PectoralPivot',None);bpy.context.collection.objects.link(pivot);pivot.parent=root
        pts=[(side*x,y,z) for x,y,z in points]
        b.fin('Curved pectoral',pts,material,edge,pivot,thick)
        if tier>=2:
            n=4 if tier==2 else 7
            for i in range(n):
                tip=along(pts[1:-1],(i+.5)/n)
                mid=tuple(pts[0][k]+(tip[k]-pts[0][k])*.55 for k in range(3))
                b.line('Pectoral ray',[pts[0],(mid[0],mid[1],mid[2]),(tip[0]*.94,tip[1]*.94,tip[2]*.94)],raymat,pivot,.006)
        obj=b.merge_parts(pivot,'PectoralMesh')
        pivot.location=b.vec(pts[0]);obj.location=-pivot.location
        if tier>=2:
            for frame,angle in [(1,0),(7,swing*side),(13,0),(19,-.72*swing*side),(25,0)]:
                pivot.rotation_euler.y=angle;pivot.keyframe_insert(data_path='rotation_euler',index=1,frame=frame)
            pivot.animation_data.action.name='swim'

def richeyes(b,root,tier,width,y,z,iris,cream):
    if tier<3:return
    for side in [-1,1]:
        for i in range(14):
            a=i*2*math.pi/14
            b.line('Iris filament',[(side*(width+.196),y+.015+.055*math.sin(a),z+.073+.048*math.cos(a)),
                                    (side*(width+.194),y+.015+.092*math.sin(a),z+.073+.082*math.cos(a))],iris,root,.0024)
        b.sphere('Secondary sparkle',(side*(width+.206),y-.012,z+.126),(.012,.018,.016),cream,root,*b.LEVEL['small'])


def butterfly(b,root,tier,palette,dims,shape,seg):
    lemon,citron=palette['Lemon'],palette['Citron']
    cream,dark,gold=palette['Pearl'],palette['Ink'],palette['Honey']
    rays=b.mat('Butterfly fin rays',(1,.86,.34),.28);amber=b.mat('Butterfly edge',(.95,.48,.02),.34)
    drop(root,('Rounded dorsal','Rounded anal','Pectoral','Eyespot','False eyespot','Pointed snout','Mouth','Dorsal ray'))
    # A forceps snout tapering to a pinched mouth, not a blunt ball.
    tube(b,'Tapered snout',root,lemon,[(0,.01,.58),(0,-.015,.76),(0,-.035,.90),(0,-.050,1.00)],[.175,.145,.102,.052],seg)
    b.sphere('Upper lip',(0,-.066,1.018),(.050,.038,.030),cream,root,*b.LEVEL['small'])
    b.sphere('Mouth',(0,-.078,1.042),(.030,.024,.014),dark,root,*b.LEVEL['tiny'])
    sail(b,'Sculpted dorsal',root,dims,(.60,-.80),lambda t:.13+.15*math.sin(math.pi*(.10+.82*t)),citron,amber,rays,tier,1,.021,shape,.024,7)
    sail(b,'Sculpted anal',root,dims,(.30,-.78),lambda t:.11+.13*math.sin(math.pi*(.16+.76*t)),citron,amber,rays,tier,-1,.019,shape,.020,5)
    for side in [-1,1]:
        # The false eye is a disc in the skin with a pale halo, no longer a bead.
        patch(b,'Eyespot halo',root,dims,side,(.60,-.40),(.40,.155),cream,.009,seg,shape)
        patch(b,'Eyespot',root,dims,side,(.60,-.40),(.29,.112),dark,.014,seg,shape)
        gill=[(1.18-i*.33,.22+.10*math.cos(1.18-i*.33)) for i in range(8)]
        stripe(b,'Gill opening',root,dims,side,gill,dark,.009,.007,shape)
        stripe(b,'Gill lip',root,dims,side,[(a,z-.032) for a,z in gill],citron,.012,.009,shape)
    if tier>=2:
        scales(b,root,dims,citron,tier,(-.78,.60),[-1.22+i*.235 for i in range(11)],
               lambda z,a:abs(z-.49)<.20 or abs(z+.59)<.10 or ((z+.40)/.20)**2+((a-.60)/.52)**2<1.2,shape,stagger=.118)
    pectorals(b,root,tier,[(.205,-.05,.30),(.40,-.02,.19),(.53,-.14,.01),(.44,-.31,-.11),(.24,-.20,.05)],citron,amber,rays,.30,.010)
    richeyes(b,root,tier,.19,.20,.49,gold,cream)
    return rays


def wrasse(b,root,tier,palette,dims,shape,seg):
    jade,rose=palette['Jade'],palette['Coral pink']
    cream,dark,gold=palette['Pearl'],palette['Ink'],palette['Honey']
    rays=b.mat('Wrasse fin rays',(1,.78,.22),.26);teal=b.mat('Wrasse edge',(.01,.33,.27),.33)
    drop(root,('Long dorsal','Anal','Pectoral','Cheek ribbon','Smile'))
    reshape(root,dims,shape)
    b.sphere('Upper lip',(0,-.030,1.042),(.050,.032,.055),jade,root,*b.LEVEL['small'])
    b.sphere('Lower lip',(0,-.076,1.026),(.044,.028,.048),rose,root,*b.LEVEL['small'])
    b.sphere('Mouth',(0,-.052,1.082),(.028,.019,.012),dark,root,*b.LEVEL['tiny'])
    for side in [-1,1]:
        # Cheek ribbons become facial bands flush with the cone of the head.
        for a0,ra in [(.40,.055),(.06,.075),(-.30,.055)]:
            patch(b,'Cheek band',root,dims,side,(a0,.74),(ra,.17),rose,.007,seg,shape)
        gill=[(1.16-i*.33,.44+.10*math.cos(1.16-i*.33)) for i in range(8)]
        stripe(b,'Gill opening',root,dims,side,gill,teal,.009,.006,shape)
    sail(b,'Long dorsal',root,dims,(.74,-1.00),lambda t:.10+.09*math.sin(math.pi*(.20+.70*t)),jade,rose,rays,tier,1,.018,shape,.014,7)
    sail(b,'Anal',root,dims,(.04,-.94),lambda t:.09+.09*math.sin(math.pi*t),jade,rose,rays,tier,-1,.016,shape,.012,5)
    if tier>=2:
        # Trailing filaments off the leading edge of the dorsal, a wrasse signature.
        for i in range(3):
            z=.72-i*.14
            b.line('Dorsal filament',[(.023,.24,z),(.024,.46,z-.08),(.023,.62+.03*i,z-.22)],rose,root,.006)
        scales(b,root,dims,teal,tier,(-.86,.60),[-.70,-.58,-.22,-.10,.02,.46,.64,.82,1.00,1.18],None,shape,
               .0022 if tier==3 else .0030,size=(.042,.085) if tier==3 else (.062,.115))
    pectorals(b,root,tier,[(.235,-.03,.50),(.44,-.01,.38),(.58,-.14,.16),(.50,-.32,-.02),(.28,-.22,.22)],gold,rose,rays,.38,.011)
    richeyes(b,root,tier,.225,.115,.79,gold,cream)
    return rays


def gramma(b,root,tier,palette,dims,shape,seg):
    orchid,sunshine=palette['Orchid'],palette['Sunshine']
    cream,dark,gold,orange=palette['Pearl'],palette['Ink'],palette['Honey'],palette['Tangerine']
    rays=b.mat('Gramma fin rays',(1,.83,.30),.27);plum=b.mat('Gramma edge',(.24,.02,.48),.33)
    lilac=b.mat('Gramma scales',(.56,.14,.86),.30);amber=b.mat('Gramma gold scales',(1,.55,.04),.30)
    drop(root,('Purple dorsal','Golden dorsal','Anal','Pectoral','Dorsal eyespot','Eye stripe','Smile'))
    reshape(root,dims,shape)
    # Interlocking tongues soften the hard purple/gold seam at z=-.05.
    count=9 if tier==1 else 13 if tier==2 else 17
    step=2.60/(count-1)
    for side in [-1,1]:
        for i in range(count):
            a=-1.30+i*step;d=.09+.05*math.sin(i*1.7)
            patch(b,'Golden tongue',root,dims,side,(a,-.05+d*.55),(step*.36,d*.62),sunshine,.008,seg,shape)
            patch(b,'Orchid tongue',root,dims,side,(a+step*.5,-.05-d*.60),(step*.36,d*.66),orchid,.008,seg,shape)
        gill=[(1.20-i*.34,.42+.10*math.cos(1.20-i*.34)) for i in range(8)]
        stripe(b,'Gill opening',root,dims,side,gill,plum,.009,.006,shape)
        stripe(b,'Gill lip',root,dims,side,[(a,z-.032) for a,z in gill],orchid,.011,.008,shape)
        stripe(b,'Eye stripe',root,dims,side,[(.62,.88),(.52,.82),(.42,.74),(.28,.66),(.12,.58),(-.02,.51)],dark,.013,.008,shape)
    b.sphere('Upper lip',(0,-.055,.958),(.085,.036,.058),orchid,root,*b.LEVEL['small'])
    b.sphere('Lower lip',(0,-.108,.938),(.072,.030,.050),plum,root,*b.LEVEL['small'])
    b.sphere('Mouth',(0,-.078,1.002),(.050,.028,.015),dark,root,*b.LEVEL['tiny'])
    sail(b,'Purple dorsal',root,dims,(.60,-.04),lambda t:.09+.11*math.sin(math.pi*(.25+.75*t)),orchid,plum,rays,tier,1,.021,shape,.020,4)
    sail(b,'Golden dorsal',root,dims,(-.04,-.90),lambda t:(.09+.14*math.sin(math.pi*t*.9))*(1-.32*t),sunshine,orange,rays,tier,1,.021,shape,.022,6)
    sail(b,'Anal',root,dims,(-.10,-.86),lambda t:(.08+.11*math.sin(math.pi*t))*(1-.25*t),sunshine,orange,rays,tier,-1,.018,shape,.018,5)
    if tier>=2:
        # Two passes: lilac over the purple front, deeper gold over the yellow rear.
        angles=[-1.18+i*.30 for i in range(9)];rows=11 if tier==3 else 6
        scales(b,root,dims,lilac,tier,(.02,.58),angles,None,shape,stagger=.15,rows=rows)
        scales(b,root,dims,amber,tier,(-.82,-.14),angles,None,shape,stagger=.15,rows=rows)
    pectorals(b,root,tier,[(.26,-.05,.42),(.48,-.03,.30),(.60,-.17,.08),(.50,-.34,-.08),(.30,-.24,.16)],sunshine,orange,rays,.30,.011)
    richeyes(b,root,tier,.235,.14,.73,gold,cream)
    return rays


def trigger(b,root,tier,palette,dims,shape,seg):
    charcoal,ochre=palette['Charcoal'],palette['Saffron']
    cream,dark=palette['Pearl'],palette['Ink']
    rays=b.mat('Trigger fin rays',(1,.72,.20),.28);indigo=b.mat('Trigger edge',(.015,.04,.075),.32)
    plate=b.mat('Trigger plates',(.10,.17,.24),.42)
    drop(root,('Pearl spot','Saddle fleck','Rear dorsal','Anal','Pectoral','Trigger spine','Lip','Mouth'))
    reshape(root,dims,shape)
    # The clown-trigger spots sit in the skin now; big and low, thinning up the flank.
    cols,rows=(3,3) if tier==1 else (4,4) if tier==2 else (4,6)
    for side in [-1,1]:
        for r in range(rows):
            for c in range(cols):
                a=-1.32+c*(1.06/(cols-1))+(r%2)*.11;z=-.66+r*(.98/(rows-1))
                ry=radii(dims,z,shape)[1];s=.125+.032*math.sin(r*1.3+c)-.030*max(0.,a+.55)
                patch(b,'Pearl spot',root,dims,side,(a,z),(s,s*ry*1.05),cream,.010,seg,shape)
        stripe(b,'Gill slit',root,dims,side,[(.36,.50),(.20,.44),(.04,.38),(-.13,.33)],indigo,.013,.007,shape)
        stripe(b,'Cheek groove',root,dims,side,[(-.62,.86),(-.52,.74),(-.46,.62),(-.44,.50)],ochre,.010,.007,shape)
    patch(b,'Golden saddle',root,dims,1,(math.pi/2,-.16),(1.02,.20),ochre,.009,seg*2,shape)
    patch(b,'Chin blaze',root,dims,1,(-math.pi/2,.60),(.60,.13),cream,.009,seg*2,shape)
    tube(b,'Snout',root,ochre,[(0,-.02,.70),(0,-.05,.86),(0,-.075,.95)],[.205,.155,.100],seg)
    b.sphere('Upper lip',(0,-.055,.982),(.100,.038,.040),cream,root,*b.LEVEL['small'])
    b.sphere('Lower lip',(0,-.116,.964),(.088,.034,.036),ochre,root,*b.LEVEL['small'])
    b.sphere('Mouth',(0,-.086,1.010),(.060,.030,.016),dark,root,*b.LEVEL['tiny'])
    # A stout locking spine with its trigger behind it, both tapered cones.
    tube(b,'Trigger spine',root,ochre,[(0,.42,.31),(0,.64,.27),(0,.84,.21),(0,1.00,.13)],[.078,.060,.041,.020],seg,'y')
    tube(b,'Trigger latch',root,ochre,[(0,.44,.13),(0,.60,.09),(0,.72,.04)],[.048,.034,.017],seg,'y')
    b.fin('Spine membrane',[(0,.50,.25),(0,.82,.17),(0,.66,.07),(0,.46,.11)],charcoal,ochre,root,.012)
    sail(b,'Rear dorsal',root,dims,(-.08,-.86),lambda t:.10+.19*math.sin(math.pi*(.16+.70*t)),cream,ochre,rays,tier,1,.024,shape,.024,5)
    sail(b,'Anal',root,dims,(-.12,-.84),lambda t:.09+.17*math.sin(math.pi*(.16+.70*t)),cream,ochre,rays,tier,-1,.022,shape,.022,5)
    if tier>=2:
        scales(b,root,dims,plate,tier,(-.70,.46),[.16+i*.30 for i in range(5)],None,shape,.0032)
    pectorals(b,root,tier,[(.29,-.03,.34),(.52,-.02,.22),(.64,-.16,-.02),(.54,-.34,-.16),(.33,-.22,.06)],ochre,indigo,rays,.30,.012)
    richeyes(b,root,tier,.245,.25,.62,ochre,cream)
    return rays


BUILDERS={'butterflyfish':butterfly,'wrasse':wrasse,'royal-gramma':gramma,'triggerfish':trigger}


def enhance(b, root, kind, detail, palette):
    tier={'standard':1,'high':2,'hd':3}[detail]
    rays=BUILDERS[kind](b,root,tier,palette,DIMS[kind],SHAPE.get(kind),(10,14,20)[tier-1])
    if tier==3:
        for name in ['Pearl','Ink','Honey']:
            bpy.data.materials[name].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.17
    return rays


def tail(b, parent, kind, detail, base, edge, rays):
    tier={'standard':1,'high':2,'hd':3}[detail]
    form,z0,h,p1,p2,p3=TAIL[kind]
    n=(14,22,34)[tier-1];outline=[]
    for i in range(n+1):
        u=1-2*i/n
        if form=='fan':
            a=u*.97;r=p1+(p2 if tier>=2 else p2*.35)*math.cos(a*p3)
            outline.append((.022*math.sin(a*2),h*math.sin(a),z0-r*math.cos(a)))
        else:
            d=p1+p2*abs(u)**p3+(.020 if tier>=2 else .006)*math.sin(u*11)
            outline.append((.022*u,h*u,z0-d))
    b.fin('Sculpted caudal',[(0,.10,z0+.02)]+outline+[(0,-.10,z0+.02)],base,edge,parent,.012)
    if tier>=2:
        b.line('Caudal edge',[(x+.017,y*.96,z0+(z-z0)*.96) for x,y,z in outline],edge,parent,.010)
    count=5 if tier==1 else 9 if tier==2 else 15
    for side in [-1,1]:
        for i in range(count):
            x,y,z=outline[int((i+.5)*n/count)]
            b.line('Caudal ray',[(side*.020,0,z0-.03),(side*.027,y*.45,z0+(z-z0)*.45),
                                 (side*.024+x,y*.90,z0+(z-z0)*.90)],rays,parent,.006)
