"""Four-tier goldfish, betta and angelfish detail: flowing veils, layered rays and fine scales."""
import bpy
import math

TIERS={'standard':1,'high':2,'hd':3}
SHAPE={'goldfish':(.50,.56,.90),'betta':(.30,.42,1.00),'angelfish':(.20,.76,.82)}
EYE={'goldfish':(.38,.17,.62),'betta':(.22,.15,.72),'angelfish':(.15,.20,.50)}


def _mix(p,q,t):return tuple(a+(c-a)*t for a,c in zip(p,q))
def _shift(p,dx):return (p[0]+dx,p[1],p[2])
def _hull(scale,y,z,push=.006):
    w,h,l=scale
    return w*math.sqrt(max(.001,1-(y/h)**2-(z/l)**2))+push


def _ramp(t,rise,fall,peak,floor):
    # Quick rise into a long plateau, then a taper back down to the peduncle.
    return floor+peak*min(1,t/rise)**.7*(1-max(0,(t-fall)/(1-fall))**1.4)


def _sail(b,name,parent,material,edge,tier,scale,zr,profile,thick=.013,ripple=.10,freq=11,wave=.03,sign=1,inset=.93):
    # A dorsal or anal sheet whose root hugs the body and whose free edge ripples.
    if tier==1:ripple*=.5;freq=max(4,round(freq*.55))
    w,h,l=scale;n=14 if tier==1 else 22 if tier==2 else 34;out=[];root=[]
    for i in range(n+1):
        t=i/n;z=zr[0]+(zr[1]-zr[0])*t;r=h*math.sqrt(max(.004,1-(z/l)**2))
        rise=profile(t)
        out.append((wave*math.sin(t*4.3),sign*(r*inset+rise*(1+ripple*math.cos(t*freq))),z))
        root.append((0,sign*r*inset,z))
    b.fin(name,out+root[::-1],material,edge,parent,thick)
    return out,root


def _sailrays(b,parent,out,root,material,tier,off,width,name='Fin ray'):
    count=5 if tier==1 else 9 if tier==2 else 14
    n=len(out)-1
    for s in [-1,1]:
        for i in range(count):
            j=round((i+.5)*n/count);a=root[j];tip=out[j]
            b.line(name,[_shift(a,s*off)]+[_shift(_mix(a,tip,f),s*off) for f in (.55,.94)],material,parent,width)


def _fan(b,name,parent,material,edge,tier,origin,span,radius,fork=0,spread=0,wave=0,thick=.012,ripple=.035,freq=11,taper=.24):
    # A caudal fan swept around its peduncle; fork pinches the middle into lobes.
    if tier==1:ripple*=.55;freq=max(4,round(freq*.6))
    ox,oy,oz=origin;n=20 if tier==1 else 30 if tier==2 else 46;out=[]
    for i in range(n+1):
        a=span-2*span*i/n
        r=radius*(1-fork*math.exp(-(a/.34)**2))*(1-taper*(abs(a)/span)**3)+ripple*math.cos(a*freq)
        out.append((ox+spread*r*math.cos(a)+wave*math.sin(a*2),oy+r*math.sin(a),oz-r*math.cos(a)))
    b.fin(name,[(ox,oy+.10,oz)]+out+[(ox,oy-.10,oz)],material,edge,parent,thick)
    return out


def _fanrays(b,parent,out,origin,material,tier,off,width,count,name='Tail ray'):
    n=len(out)-1
    for s in [-1,1]:
        for i in range(count):
            tip=out[round(i*n/(count-1))]
            b.line(name,[_shift(origin,s*off)]+[_shift(_mix(origin,tip,f),s*off) for f in (.5,.93)],material,parent,width)


def _trim(b,parent,out,origin,material,tier,off,width):
    if tier>=2:
        for s in [-1,1]:b.line('Fin trim',[_shift(_mix(origin,p,.97),s*off) for p in out],material,parent,width)


def _scales(b,root,scale,material,tier,rows,cols,zr,width,skip=None,flat=False):
    w,h,l=scale;arc=.034 if tier==3 else .052;span=.062 if tier==3 else .10
    for row in range(rows):
        z=zr[0]+row*(zr[1]-zr[0])/(rows-1)
        for col in range(cols):
            u=(col+(row%2)*.5)/cols
            if flat:
                # Flat-sided fish get scales spread evenly up the flank, not around it.
                v=u*2 if u<.5 else 2-u*2
                a=math.asin(max(-.999,min(.999,-.94+1.88*v)))
                if u>=.5:a=math.pi-a
            else:
                a=u*2*math.pi
                if abs(math.cos(a))<.22:continue
            if skip and skip(z,a):continue
            pts=[]
            for j in range(7):
                t=-math.pi/2+j*math.pi/6
                zz=z+arc*math.cos(t);aa=a+span*math.sin(t)
                r=math.sqrt(max(.004,1-(zz/l)**2))
                pts.append(((w*r+.004)*math.cos(aa),(h*r+.004)*math.sin(aa),zz))
            b.line('Scale arc',pts,material,root,width)


def _pivot(root,name):
    p=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(p);p.parent=root
    return p


def _seal(b,pivot,name,at,tier,axis,amp,swing=(0,1,0,-.7,0)):
    obj=b.merge_parts(pivot,name);pivot.location=b.vec(at);obj.location=-pivot.location
    if tier>=2:
        for f,k in zip((1,7,13,19,25),swing):
            pivot.rotation_euler[axis]=amp*k;pivot.keyframe_insert(data_path='rotation_euler',index=axis,frame=f)
        pivot.animation_data.action.name='swim'


def _taper(obj,end=.22):
    pts=obj.data.splines[0].points
    for i,p in enumerate(pts):p.radius=1-(1-end)*i/(len(pts)-1)


def _polish(b,root,kind,palette):
    # Iris spokes inside the existing eye shells plus a second, smaller highlight.
    w,y,z=EYE[kind];cream,gold=palette['Pearl'],palette['Honey']
    for side in [-1,1]:
        for i in range(14):
            a=i*2*math.pi/14
            b.line('Iris filament',[(side*(w+.195),y+.015+.068*math.sin(a),z+.073+.060*math.cos(a)),(side*(w+.193),y+.015+.108*math.sin(a),z+.073+.096*math.cos(a))],gold,root,.0025)
        b.sphere('Secondary eye sparkle',(side*(w+.214),y-.022,z+.123),(.012,.018,.016),cream,root,*b.LEVEL['small'])
    for name in ['Pearl','Ink','Honey']:
        palette[name].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.17


def enhance(b, root, kind, detail, palette):
    tier=TIERS[detail];sc=SHAPE[kind]
    cream,dark,gold=palette['Pearl'],palette['Ink'],palette['Honey']
    strip=('Dorsal','Ventral','Pectoral') if kind=='goldfish' else ('Veil','Pectoral','Pelvic') if kind=='betta' else ('Sail','Pectoral','Streamer')
    for obj in list(root.children):
        if obj.name.startswith(strip):bpy.data.objects.remove(obj,do_unlink=True)
    if kind=='goldfish':
        skin,rim=palette['Marigold'],palette['Tangerine']
        amber=b.mat('Goldfish amber',(1,.47,.05),.34)
        highlight=rays=b.mat('Goldfish fin rays',(1,.80,.34),.28)
        edges=b.mat('Goldfish scale edges',(.84,.30,.02),.30)
        out,base=_sail(b,'Sculpted dorsal',root,skin,rim,tier,sc,(.54,-.76),lambda t:_ramp(t,.30,.45,.34,.05),.014,.09,15 if tier==3 else 9,.03)
        _sailrays(b,root,out,base,rays,tier,.020,.009 if tier==1 else .008 if tier==2 else .007,'Dorsal ray')
        out,base=_sail(b,'Sculpted anal',root,amber,rim,tier,sc,(-.06,-.74),lambda t:_ramp(t,.34,.40,.30,.05),.013,.10,13 if tier==3 else 8,.025,-1)
        _sailrays(b,root,out,base,rays,tier,.018,.009 if tier==1 else .008 if tier==2 else .007,'Anal ray')
        for side in [-1,1]:
            p=_pivot(root,'PectoralPivot')
            b.fin('Curved pectoral',[(side*.40,-.10,.36),(side*.60,-.12,.26),(side*.74,-.18,.12),(side*.78,-.28,-.06),(side*.69,-.36,-.22),(side*.52,-.32,-.28),(side*.40,-.17,-.12)],skin,rim,p,.010)
            if tier>=2:
                for i in range(4 if tier==2 else 7):
                    tip=(side*(.70-.042*i),-.19-.028*i,.08-.050*i)
                    b.line('Pectoral ray',[(side*.42,-.11,.30),_mix((side*.42,-.11,.30),tip,.55),tip],rays,p,.006)
            _seal(b,p,'PectoralMesh',(side*.40,-.10,.36),tier,1,.26*side)
            q=_pivot(root,'PelvicPivot')
            b.fin('Pelvic fin',[(side*.16,-.42,.26),(side*.31,-.60,.10),(side*.26,-.75,-.16),(side*.12,-.50,-.06)],amber,rim,q,.009)
            if tier>=2:
                for i in range(3 if tier==2 else 5):
                    tip=(side*(.26-.032*i),-.60-.034*i,.01-.052*i)
                    b.line('Pelvic ray',[(side*.17,-.44,.22),tip],rays,q,.006)
            _seal(b,q,'PelvicMesh',(side*.16,-.42,.26),tier,1,.20*side,(1,0,-1,0,1))
            def shell(i):
                y=.30-i*.076;z=.44+.10*math.sin(i/10*math.pi)
                return (side*_hull(sc,y,z,.008),y,z)
            pts=[shell(i) for i in range(11)]
            b.line('Gill plate',pts,rim,root,.010)
            b.line('Gill lip',[(x+side*.013,y,z-.034) for x,y,z in pts],amber,root,.013)
        b.sphere('Upper lip',(0,-.095,.884),(.115,.036,.038),skin,root)
        b.sphere('Lower lip',(0,-.162,.870),(.10,.030,.034),amber,root)
        if tier>=2:_scales(b,root,sc,edges,tier,11 if tier==2 else 17,16 if tier==2 else 24,(-.74,.52),.0033 if tier==2 else .0025,lambda z,a:math.sin(a)<-.45)
    elif kind=='betta':
        skin,rim=palette['Amethyst'],palette['Garnet']
        sheen=b.mat('Betta sheen',(.72,.14,.52),.26)
        highlight=rays=b.mat('Betta fin rays',(.86,.52,1),.24)
        blush=b.mat('Betta blush',(.74,.06,.20),.32)
        p=_pivot(root,'DorsalPivot')
        out,base=_sail(b,'Veil dorsal',p,skin,rim,tier,sc,(.36,-1.00),lambda t:_ramp(t,.22,.60,.66,.10),.014,.13,15 if tier==3 else 9,.05)
        _sailrays(b,p,out,base,rays,tier,.023,.010 if tier==1 else .009 if tier==2 else .008,'Dorsal ray')
        _seal(b,p,'DorsalMesh',(0,.30,.38),tier,1,.13,(1,0,-1,0,1))
        p=_pivot(root,'AnalPivot')
        out,base=_sail(b,'Veil anal',p,skin,rim,tier,sc,(.30,-1.04),lambda t:_ramp(t,.20,.55,.74,.12),.014,.13,13 if tier==3 else 8,.05,-1)
        _sailrays(b,p,out,base,rays,tier,.023,.010 if tier==1 else .009 if tier==2 else .008,'Anal ray')
        _seal(b,p,'AnalMesh',(0,-.28,.32),tier,1,.13,(-1,0,1,0,-1))
        for side in [-1,1]:
            p=_pivot(root,'PectoralPivot')
            b.fin('Curved pectoral',[(side*.26,-.06,.46),(side*.42,-.09,.36),(side*.56,-.20,.16),(side*.50,-.32,-.06),(side*.34,-.28,-.16),(side*.26,-.13,-.02)],skin,rim,p,.008)
            if tier>=2:
                for i in range(4 if tier==2 else 6):
                    tip=(side*(.50-.040*i),-.16-.032*i,.18-.055*i)
                    b.line('Pectoral ray',[(side*.28,-.07,.40),_mix((side*.28,-.07,.40),tip,.55),tip],rays,p,.005)
            _seal(b,p,'PectoralMesh',(side*.26,-.06,.46),tier,1,.30*side)
            b.fin('Pelvic blade',[(side*.07,-.30,.42),(side*.13,-.66,.18),(side*.16,-1.08,-.12),(side*.10,-1.02,-.02),(side*.05,-.60,.24),(side*.04,-.28,.36)],blush,rim,root,.010)
            b.line('Gill crease',[(side*_hull(sc,.20,.60,.007),.20,.60),(side*_hull(sc,.02,.62,.007),.02,.62),(side*_hull(sc,-.18,.56,.007),-.18,.56)],rim,root,.011)
            b.fin('Gill beard',[(0,-.13,.86),(side*.19,-.30,.70),(side*.15,-.48,.48),(0,-.32,.50)],blush,rim,root,.011)
        b.sphere('Lip',(0,-.085,.982),(.078,.036,.032),blush,root)
        if tier>=2:_scales(b,root,sc,sheen,tier,12 if tier==2 else 18,14 if tier==2 else 20,(-.78,.62),.0034 if tier==2 else .0026)
    else:
        skin,rim=palette['Moonlight'],palette['Ink']
        highlight=pearl=b.mat('Angel fin rays',(.90,.95,1),.24)
        edges=b.mat('Angel scale edges',(.44,.52,.62),.30)
        out,base=_sail(b,'Sail dorsal',root,skin,rim,tier,sc,(.48,-.74),lambda t:_ramp(t,.24,.34,.62,.06),.012,.05,17 if tier==3 else 11,.028)
        _sailrays(b,root,out,base,pearl,tier,.019,.008 if tier==1 else .007 if tier==2 else .006,'Dorsal ray')
        out,base=_sail(b,'Sail ventral',root,skin,rim,tier,sc,(.44,-.74),lambda t:_ramp(t,.26,.34,.58,.06),.012,.05,15 if tier==3 else 10,.028,-1)
        _sailrays(b,root,out,base,pearl,tier,.019,.008 if tier==1 else .007 if tier==2 else .006,'Anal ray')
        for side in [-1,1]:
            p=_pivot(root,'PectoralPivot')
            b.fin('Curved pectoral',[(side*.16,-.05,.36),(side*.29,-.10,.24),(side*.40,-.22,.04),(side*.34,-.33,-.12),(side*.21,-.27,-.14),(side*.16,-.12,-.02)],skin,rim,p,.008)
            if tier>=2:
                for i in range(4 if tier==2 else 6):
                    tip=(side*(.40-.034*i),-.15-.030*i,.10-.042*i)
                    b.line('Pectoral ray',[(side*.17,-.06,.31),_mix((side*.17,-.06,.31),tip,.55),tip],pearl,p,.005)
            _seal(b,p,'PectoralMesh',(side*.16,-.05,.36),tier,1,.28*side)
            q=_pivot(root,'StreamerPivot')
            b.fin('Pelvic streamer',[(side*.05,-.42,.34),(side*.09,-.72,.19),(side*.13,-1.30,-.11),(side*.09,-1.31,-.07),(side*.05,-.76,.16),(side*.03,-.44,.29)],gold,cream,q,.007)
            if tier>=2:_taper(b.line('Streamer rib',[(side*.05,-.46,.31),(side*.09,-.92,.05),(side*.12,-1.30,-.10)],cream,q,.005))
            _seal(b,q,'StreamerMesh',(side*.05,-.44,.34),tier,1,.17*side,(1,0,-1,0,1))
            def shell(i):
                y=.34-i*.085;z=.40+.10*math.sin(i/10*math.pi)
                return (side*_hull(sc,y,z,.007),y,z)
            pts=[shell(i) for i in range(11)]
            b.line('Gill plate',pts,rim,root,.009)
            b.line('Gill lip',[(x+side*.010,y,z-.030) for x,y,z in pts],skin,root,.011)
        b.sphere('Snout',(0,-.050,.772),(.062,.058,.050),skin,root)
        b.sphere('Lip',(0,-.088,.796),(.048,.024,.022),rim,root)
        if tier>=2:_scales(b,root,sc,edges,tier,14 if tier==2 else 21,24 if tier==2 else 38,(-.66,.56),.0030 if tier==2 else .0022,lambda z,a:min(abs(z-.42),abs(z+.02),abs(z+.46))<.10,True)
    if tier==3:_polish(b,root,kind,palette)
    return highlight


def tail(b, parent, kind, detail, base, edge, rays):
    tier=TIERS[detail]
    if kind=='goldfish':
        for side in [-1,1]:
            origin=(side*.05,.02,-.85)
            out=_fan(b,'Fantail lobe',parent,base,edge,tier,origin,1.18,.98,.52,side*.42,.03,.010,.030 if tier<3 else .020,9 if tier<3 else 15)
            _fanrays(b,parent,out,origin,rays,tier,.018,.009 if tier==3 else .011,5 if tier==1 else 8 if tier==2 else 13)
            _trim(b,parent,out,origin,edge,tier,.016,.009)
    elif kind=='betta':
        origin=(0,.02,-.84)
        out=_fan(b,'Halfmoon veil',parent,base,edge,tier,origin,1.42,1.02,0,0,.05,.013,.050 if tier<3 else .034,9 if tier<3 else 15,.22)
        _fanrays(b,parent,out,origin,rays,tier,.022,.010 if tier==3 else .012,6 if tier==1 else 11 if tier==2 else 17)
        _trim(b,parent,out,origin,edge,tier,.020,.011)
    else:
        origin=(0,0,-.84)
        out=_fan(b,'Forked caudal',parent,base,edge,tier,origin,1.04,.86,.42,0,.02,.011,.014,9,.10)
        _fanrays(b,parent,out,origin,rays,tier,.017,.007 if tier==3 else .009,5 if tier==1 else 8 if tier==2 else 13)
        _trim(b,parent,out,origin,edge,tier,.015,.008)
        for sign in [-1,1]:
            _taper(b.line('Caudal filament',[(0,sign*.60,-1.22),(.012,sign*.74,-1.42),(0,sign*.82,-1.64)],base,parent,.018))
