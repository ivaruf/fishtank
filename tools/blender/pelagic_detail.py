"""Four-tier detail for the odd-anatomy species: lionfish, seahorse, manta ray and shark.
These do not share the standard fish body plan, so each gets its own layer and its own tail.
"""
import bpy
import math

TIER = {'standard': 1, 'high': 2, 'hd': 3}


def drop(root, *names):
    for o in list(root.children):
        if o.name.startswith(names): bpy.data.objects.remove(o, do_unlink=True)


def taper(obj, end=.15, start=1.):
    # Curve point radii turn a swept line into a tapered spine.
    pts = obj.data.splines[0].points; n = len(pts) - 1
    for i, p in enumerate(pts): p.radius = start + (end - start) * (i / n if n else 0)
    return obj


def sheet(b, name, pts, mat, edge, parent, t=.008):
    # A membrane extruded along its own normal, so a curved outline keeps its sweep.
    n = len(pts); ax = ay = az = 0
    for i, (x, y, z) in enumerate(pts):
        x2, y2, z2 = pts[(i + 1) % n]
        ax += (y - y2) * (z + z2); ay += (z - z2) * (x + x2); az += (x - x2) * (y + y2)
    d = math.sqrt(ax * ax + ay * ay + az * az) or 1
    ax, ay, az = ax * t / d, ay * t / d, az * t / d
    verts = [(x + s * ax, y + s * ay, z + s * az) for s in (-1, 1) for x, y, z in pts]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    obj = b.mesh(name, verts, faces, mat, parent); obj.data.materials.append(edge)
    for p in list(obj.data.polygons)[2:]: p.material_index = 1
    bevel = obj.modifiers.new('Soft edges', 'BEVEL'); bevel.width = min(.026, t * 1.7)
    bevel.segments = b.LEVEL['bevel']; bevel.affect = 'EDGES'
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name); obj.select_set(False)
    return obj


def tube(b, name, path, radii, mat, parent, seg=8, ref=(1, 0, 0), shape=None):
    # Swept rings along a polyline; the fixed reference axis keeps the frame from twisting.
    verts = []; faces = []; n = len(path)
    for i, (p, r) in enumerate(zip(path, radii)):
        q = path[min(i + 1, n - 1)]; o = path[max(i - 1, 0)]
        t = [q[k] - o[k] for k in range(3)]
        L = math.sqrt(sum(c * c for c in t)) or 1; t = [c / L for c in t]
        dot = sum(ref[k] * t[k] for k in range(3))
        u = [ref[k] - dot * t[k] for k in range(3)]
        L = math.sqrt(sum(c * c for c in u)) or 1; u = [c / L for c in u]
        v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]
        for k in range(seg):
            a = 2 * math.pi * k / seg; rr = r * (shape(a) if shape else 1)
            verts.append(tuple(p[m] + rr * (math.cos(a) * u[m] + math.sin(a) * v[m]) for m in range(3)))
    for i in range(n - 1):
        for k in range(seg):
            A = i * seg + k; B = i * seg + (k + 1) % seg
            faces.append((A, B, B + seg, A + seg))
    faces += [tuple(range(seg - 1, -1, -1)), tuple(range((n - 1) * seg, n * seg))]
    obj = b.mesh(name, verts, faces, mat, parent)
    for p in obj.data.polygons: p.use_smooth = True
    return obj


def pivot(b, root, name):
    p = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(p); p.parent = root
    return p


def hinge(b, p, mesh_name, at, keys, axis=1):
    obj = b.merge_parts(p, mesh_name)
    p.location = b.vec(at); obj.location = -p.location
    if keys:
        for f, a in keys:
            p.rotation_euler[axis] = a; p.keyframe_insert(data_path='rotation_euler', index=axis, frame=f)
        p.animation_data.action.name = 'swim'
    return obj


def glossy(names=('Pearl', 'Ink', 'Honey')):
    for n in names:
        m = bpy.data.materials.get(n)
        if m: m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .17


def enhance(b, root, kind, detail, palette):
    tier = TIER[detail]
    return {'lionfish': lionfish, 'seahorse': seahorse, 'manta-ray': manta, 'shark': shark}[kind](b, root, tier, palette)


def tail(b, parent, kind, detail, base, edge, rays):
    tier = TIER[detail]
    {'lionfish': lionfish_tail, 'seahorse': seahorse_tail, 'manta-ray': manta_tail, 'shark': shark_tail}[kind](b, parent, tier, base, edge, rays)


def lionfish(b, root, tier, palette):
    rust, ivory = palette['Rust'], palette['Ivory']
    cream, dark, gold = palette['Pearl'], palette['Ink'], palette['Honey']
    ember = b.mat('Lion ember', (.44, .075, .03), .38)
    rays = b.mat('Lion fin rays', (1, .88, .66), .30)
    stripe = b.mat('Lion pinstripe', (.20, .03, .015), .45)
    drop(root, 'Dorsal spine', 'Dorsal web', 'Fan membrane', 'Fan spine', 'Brow tassel', 'Lower lip', 'Mouth')
    steps = 4 + 2 * tier
    b.sphere('Snout', (0, -.045, .80), (.235, .19, .165), rust, root)
    b.sphere('Upper lip', (0, -.125, .905), (.145, .045, .055), ivory, root)
    b.sphere('Lower lip', (0, -.185, .885), (.125, .042, .05), ivory, root)
    b.line('Mouth', [(-.125, -.155, .885), (0, -.175, .935), (.125, -.155, .885)], dark, root, .014)

    def crest(name, n, z0, z1, hlo, hhi, sign, sweep, width):
        # Curved tapered spines with a sagging web slung between each pair.
        def p(i, t):
            z = z0 + (z1 - z0) * i / (n - 1)
            h = hlo + (hhi - hlo) * math.sin(math.pi * (i + .55) / (n + .1))
            s = .49 * math.sqrt(max(.02, 1 - (z / .96) ** 2))
            return (0, sign * (s * .87 + h * t), z + sweep * t * t)
        for i in range(n):
            taper(b.line(name + ' spine', [p(i, k / steps) for k in range(steps + 1)], ivory, root, width), .14)
            if i == n - 1: continue
            poly = [p(i, 0)] + [p(i, t) for t in (.24, .48, .70)] + [p(i + .5, .56)] + [p(i + 1, t) for t in (.70, .48, .24)] + [p(i + 1, 0)]
            sheet(b, name + ' web', poly, ember, rust, root, .006)
            if tier >= 2:
                for u in ((.34, .67) if tier == 3 else (.5,)):
                    b.line(name + ' web ray', [p(i + u, .05), p(i + u, .30), p(i + u, .54)], rays, root, .006)
    crest('Dorsal', 9 + 2 * tier, .60, -.66, .44, .86, 1, -.30, .028)
    crest('Anal', 3 + tier, -.24, -.62, .28, .46, -1, -.22, .024)

    for side in [-1, 1]:
        # The signature pectoral fan: rays on a cone, membranes scalloped between them.
        p = pivot(b, root, 'FanPivot'); anchor = (side * .30, -.055, .30)
        m = 6 + 2 * tier

        def ray(u, t):
            # Measured from straight up and swung back, so no ray reaches past the snout.
            ang = .45 + u * 2.05
            L = .78 + .40 * math.sin(math.pi * min(1, max(0, u * .90 + .06)))
            r = L * t; bend = 1 - .10 * t * t
            return (side * (.30 + .52 * r), -.055 + r * math.cos(ang) * bend, .30 - r * math.sin(ang) * .92)
        for j in range(m):
            u = j / (m - 1)
            taper(b.line('Fan spine', [ray(u, k / steps) for k in range(steps + 1)], ivory, p, .026), .12)
            if j == m - 1: continue
            uj = (j + 1) / (m - 1); um = (u + uj) / 2
            poly = [anchor] + [ray(u, t) for t in (.30, .58, .84)] + [ray(um, .70)] + [ray(uj, t) for t in (.84, .58, .30)]
            sheet(b, 'Fan membrane', poly, ember, rust, p, .006)
        hinge(b, p, 'FanMesh', anchor, [(1, 0), (7, .13 * side), (13, 0), (19, -.11 * side), (25, 0)] if tier >= 2 else None)

    for side in [-1, 1]:
        taper(b.line('Brow tassel', [(side * .28, .33, .70), (side * .32, .52, .72), (side * .335, .68, .68), (side * .315, .80, .60)], ivory, root, .030), .20)
        b.sphere('Tassel bulb', (side * .315, .815, .585), (.032, .040, .034), ivory, root, *b.LEVEL['small'])
        pts = [(side * (.43 * math.sqrt(max(.005, 1 - (y / .49) ** 2 - (z / .96) ** 2)) + .008), y, z)
               for y, z in [(-.28 + i * .075, .40 + .06 * math.sin(i / 8 * math.pi)) for i in range(9)]]
        b.line('Gill opening', pts, stripe, root, .010)
        if tier >= 2:
            taper(b.line('Cheek tassel', [(side * .30, .26, .58), (side * .35, .34, .50), (side * .36, .40, .40)], ivory, root, .018), .2)
            pel = lambda u: [(side * .13, -.30, .18 - .10 * u), (side * (.17 + .04 * u), -.58 - .06 * u, .02 - .16 * u), (side * (.18 + .05 * u), -.78 - .08 * u, -.14 - .20 * u)]
            for i in range(2 + tier): taper(b.line('Pelvic spine', pel(i / (1 + tier)), ivory, root, .019), .16)
            sheet(b, 'Pelvic web', pel(0) + pel(1)[::-1], ember, rust, root, .006)
    if tier >= 2:
        # Fine dark edging traces both boundaries of every painted band.
        n = 20 if tier == 3 else 14
        for k in range(-2, 3):
            for e in (-1, 1):
                pts = []
                for m in range(n + 1):
                    a = 2 * math.pi * m / n
                    z = (2 * math.pi * k + e * 1.266 - .7 * math.sin(a)) / 19
                    s = math.sqrt(max(.004, 1 - (z / .96) ** 2))
                    pts.append(((.43 * s + .007) * math.cos(a), (.49 * s + .007) * math.sin(a), z))
                b.line('Band edge', pts, stripe, root, .0045 if tier == 3 else .006)
    if tier == 3:
        for side in [-1, 1]:
            for i in range(16):
                a = i * 2 * math.pi / 16
                b.line('Iris filament', [(side * .527, .175 + .062 * math.sin(a), .743 + .058 * math.cos(a)),
                                         (side * .525, .175 + .100 * math.sin(a), .743 + .088 * math.cos(a))], gold, root, .0025)
        glossy()
    return rays


def lionfish_tail(b, parent, tier, base, edge, rays):
    stripe = b.PALETTE['Lion pinstripe']
    n = 14 if tier == 1 else 22 if tier == 2 else 34
    out = []
    for i in range(n + 1):
        a = .98 - i * 1.96 / n
        r = .72 + (.02 if tier == 1 else .05) * math.cos(a * (15 if tier == 3 else 9))
        out.append((.03 * math.sin(a * 2), .78 * r * math.sin(a), -.86 - r * math.cos(a)))
    b.fin('Rounded caudal', [(0, .10, -.86)] + out + [(0, -.10, -.86)], base, edge, parent, .011)
    c = 5 if tier == 1 else 9 if tier == 2 else 15
    for side in [-1, 1]:
        for i in range(c):
            a = -.9 + i * 1.8 / (c - 1)
            b.line('Caudal ray', [(side * .018, 0, -.90), (side * .026, .34 * math.sin(a), -.86 - .36 * math.cos(a)),
                                  (.03 * math.sin(a * 2) + side * .026, .70 * math.sin(a), -.86 - .70 * math.cos(a))], rays, parent, .006)
        if tier < 2: continue
        b.line('Caudal edge', [(x + side * .014, y * .96, -.86 + (z + .86) * .96) for x, y, z in out], edge, parent, .009)
        for k in (1, 2):
            arc = [(side * .024 + .02 * math.sin(a * 2), .25 * k * math.sin(a), -.86 - .27 * k * math.cos(a))
                   for a in [-.9 + j * .2 for j in range(10)]]
            b.line('Caudal band', arc, stripe, parent, .011)


SEA_SHELLS = [((0, -.05, -.10), (.25, .52, .31)), ((0, -.10, .115), (.20, .39, .16)), ((0, .43, -.045), (.17, .35, .19))]


def sea_hull(y, a, push=.010):
    # Outermost hit of the ray leaving the body axis, so plates wrap the sphere union.
    best = None
    for (cx, cy, cz), (rx, ry, rz) in SEA_SHELLS:
        A = (math.cos(a) / rx) ** 2 + (math.sin(a) / rz) ** 2
        B = -2 * math.sin(a) * cz / rz ** 2
        C = ((y - cy) / ry) ** 2 + (cz / rz) ** 2 - 1
        d = B * B - 4 * A * C
        if d < 0: continue
        r = (-B + math.sqrt(d)) / (2 * A)
        if r > 0 and (best is None or r > best): best = r
    if best is None: return None
    r = best + push
    return (r * math.cos(a), y, r * math.sin(a))


def seahorse(b, root, tier, palette):
    peach, ridge = palette['Apricot'], palette['Golden ridges']
    cream, dark, gold = palette['Pearl'], palette['Ink'], palette['Honey']
    drop(root, 'Coronet', 'Trunk ridge', 'Back plate', 'Tiny ear fin', 'Dorsal fan', 'Tube snout', 'Mouth')
    rays = b.mat('Seahorse fin rays', (1, .88, .68), .30)
    seg = 6 + 2 * tier
    # Tapered tubular snout, capped so the swept ring never shows an open end.
    path = []; rad = []
    for k in range(9):
        t = k / 8
        path.append((0, .663 - .072 * t ** 1.7, .255 + .535 * t)); rad.append(.135 - .082 * t ** .8)
    tube(b, 'Tube snout', path, rad, ridge, root, seg)
    b.sphere('Snout tip', (0, .589, .786), (.064, .062, .052), ridge, root, *b.LEVEL['small'])
    b.sphere('Mouth', (0, .586, .810), (.044, .042, .015), dark, root)
    b.sphere('Cheek', (0, .60, .34), (.235, .17, .17), peach, root)
    if tier >= 2:
        for k in range(2 + tier // 2):
            t = .34 + k * .20
            c = (0, .663 - .072 * t ** 1.7, .255 + .535 * t); r = (.135 - .082 * t ** .8) * 1.10
            b.line('Snout ring', [(r * math.cos(a), c[1] + r * math.sin(a) * .9, c[2]) for a in [j * math.pi / 5 for j in range(11)]], peach, root, .006)
    # Coronet: a curling crown of tapered spikes on a low base.
    b.sphere('Coronet base', (0, .872, .145), (.115, .058, .132), ridge, root)
    for i in range(5):
        u = i / 4; ang = -.80 + u * 1.45; L = .19 + .15 * math.sin(math.pi * u)
        y0 = .885 + .025 * math.sin(math.pi * u); z0 = .085 + .115 * u
        pts = []; rr = []
        for k in range(5):
            t = k / 4; a2 = ang + .35 * t
            pts.append((0, y0 + L * t * math.cos(a2), z0 + L * t * math.sin(a2))); rr.append(.042 * (1 - .86 * t) + .006)
        tube(b, 'Coronet spike', pts, rr, ridge, root, seg)
    if tier >= 2:
        for side in [-1, 1]:
            tube(b, 'Coronet horn', [(side * .07, .855, .12), (side * .105, .93, .09), (side * .115, .99, .05)], [.035, .022, .008], ridge, root, seg)
    # Bony rings: a wavy plate every segment, corner spines, and four running ridges.
    rings = 7 + 2 * tier; steps = 12 if tier == 1 else 16 if tier == 2 else 22
    for i in range(rings):
        y = -.46 + i * (.96 / (rings - 1))
        pts = [sea_hull(y + .020 * math.cos(4 * a), a) for a in [2 * math.pi * m / steps for m in range(steps + 1)]]
        b.line('Body plate', [p for p in pts if p], ridge, root, .016 if tier == 1 else .013)
        if tier >= 2 and i % 2 == 0:
            for a in (0, math.pi, 3 * math.pi / 2):
                p0, p1 = sea_hull(y, a, .002), sea_hull(y, a, .058)
                if p0 and p1: taper(b.line('Plate spine', [p0, p1], ridge, root, .024), .16)
    for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
        pts = [sea_hull(-.48 + j * (1.00 / (17 + 6 * tier)), a, .006) for j in range(18 + 6 * tier)]
        b.line('Trunk ridge', [p for p in pts if p], ridge, root, .012)
    for side in [-1, 1]:
        # Ear fins beat fore and aft on their own vertical hinges.
        p = pivot(b, root, 'EarPivot'); anchor = (side * .135, .47, .03)
        lobe = [anchor] + [(side * (.14 + .34 * math.sin(u)), .47 + .13 * math.cos(u * 1.7) - .17 * u / 2.6, .04 - .26 * math.sin(u) * u / 2.6 + .02 * math.cos(u * 7)) for u in [.3 + j * .38 for j in range(7)]]
        sheet(b, 'Ear fin', lobe, cream, ridge, p, .010)
        if tier >= 2:
            for j in range(3 + tier):
                t = j / (2 + tier)
                b.line('Ear ray', [(side * .17, .45, .01), (side * (.27 + .10 * t), .52 - .16 * t, -.05 - .07 * t), (side * (.37 + .05 * t), .49 - .21 * t, -.12 - .07 * t)], rays, p, .006)
        hinge(b, p, 'EarMesh', anchor, [(1, 0), (7, .34 * side), (13, 0), (19, -.30 * side), (25, 0)] if tier >= 2 else None, 2)
    # Dorsal fan: a scalloped sail on the back that flutters twice per stroke.
    p = pivot(b, root, 'FanPivot'); anchor = (0, .05, -.38)
    back = lambda y: sea_hull(y, 3 * math.pi / 2, .004)
    fe = lambda t: (0, .33 - .63 * t, -.52 - .235 * math.sin(math.pi * t) + .022 * math.cos(t * 19))
    att = [back(.30 - .10 * k) for k in range(6)]
    sheet(b, 'Dorsal fan', att + [fe(1 - j / (5 + 4 * tier)) for j in range(6 + 4 * tier)], ridge, peach, p, .009)
    for j in range(4 + 3 * tier):
        t = j / (3 + 3 * tier)
        a0 = back(.30 - .50 * t); tip = fe(t)
        b.line('Fan ray', [a0, ((a0[0] + tip[0]) / 2, (a0[1] + tip[1]) / 2, (a0[2] + tip[2]) / 2 - .015), tip], rays, p, .006)
    if tier >= 2:
        b.line('Fan edge', [fe(j / 16) for j in range(17)], ridge, p, .009)
    hinge(b, p, 'FanMesh', anchor, [(1, 0), (4, .26), (7, 0), (10, -.26), (13, 0), (16, .26), (19, 0), (22, -.26), (25, 0)], 2)
    if tier == 3:
        for side in [-1, 1]:
            b.sphere('Secondary eye sparkle', (side * .404, .748, .413), (.013, .019, .017), cream, root, *b.LEVEL['small'])
            for i in range(14):
                a = i * 2 * math.pi / 14
                b.line('Iris filament', [(side * .347, .785 + .058 * math.sin(a), .371 + .054 * math.cos(a)),
                                         (side * .345, .785 + .094 * math.sin(a), .371 + .084 * math.cos(a))], gold, root, .0025)
        glossy()
    return rays


def seahorse_tail(b, parent, tier, base, edge, rays):
    ridge = b.PALETTE['Golden ridges']
    seg = 6 + 2 * tier; n = 26 + 10 * tier
    shape = lambda a: 1 + .10 * math.cos(4 * a)
    path = []; rad = []
    for k in range(n + 1):
        t = k / n
        if t < .22:
            u = t / .22
            path.append((0, -.34 - .54 * u, -.02 - .13 * u)); rad.append(.150 - .036 * u ** .6)
        else:
            u = (t - .22) / .78; th = math.pi + u * 1.86 * math.pi; rr = .30 * (1 - u) ** 1.15 + .030
            path.append((0, -.88 + rr * math.sin(th), .18 + rr * math.cos(th))); rad.append(.100 * (1 - u) ** .8 + .016)
    tube(b, 'Prehensile tail', path, rad, base, parent, seg, shape=shape)
    for i in range(8 + 3 * tier):
        k = max(1, min(n - 1, int((i + .5) / (8 + 3 * tier) * n)))
        c = path[k]; d = [(path[k + 1][m] - path[k - 1][m]) * .16 for m in range(3)]
        band = [tuple(c[m] - d[m] for m in range(3)), c, tuple(c[m] + d[m] for m in range(3))]
        tube(b, 'Tail plate', band, [rad[k] * 1.02, rad[k] * 1.13, rad[k] * 1.02], ridge, parent, seg, shape=shape)


def manta_surf(u, v, lower, fat=1.):
    a = abs(u)
    lead = .88 * (1 - a) - .17 * a; trail = -.78 + .53 * a
    t = .115 * math.sin(math.pi * v) ** .55 * (1 - a ** 1.7) ** .6 * fat
    return (u * 1.43, .145 * a * a - .010 + (-.42 * t if lower else .62 * t), lead * (1 - v) + trail * v)


def manta(b, root, tier, palette):
    ocean, belly = palette['Ocean slate'], palette['Cloud belly']
    cream, dark, silver = palette['Pearl'], palette['Ink'], palette['Moonlight']
    drop(root, 'Wing disc', 'Cephalic lobe', 'Wing highlight', 'Head', 'Smile', 'Dorsal')
    rim = b.mat('Manta rim', (.02, .10, .16), .42)
    rays = b.mat('Manta sheen', (.26, .44, .53), .34)
    mottle = b.mat('Manta mottle', (.15, .33, .42), .40)
    seg = 6 + 2 * tier
    nx, nz = ((16, 13), (24, 18), (38, 28))[tier - 1]

    def wing(name, u0, u1, parent):
        # A closed cambered half-wing: thin at the tips and knife-edged fore and aft.
        verts = []; faces = []
        for lower in (False, True):
            for i in range(nx + 1):
                u = u0 + (u1 - u0) * i / nx
                for j in range(nz + 1): verts.append(manta_surf(u, j / nz, lower))
        layer = (nx + 1) * (nz + 1)
        for s in (0, 1):
            for i in range(nx):
                for j in range(nz):
                    k = s * layer + i * (nz + 1) + j; f = (k, k + nz + 1, k + nz + 2, k + 1)
                    faces.append(f if s == 0 else tuple(reversed(f)))
        for i in range(nx):
            for j in (0, nz):
                k = i * (nz + 1) + j; faces.append((k, k + nz + 1, k + nz + 1 + layer, k + layer))
        for i in (0, nx):
            for j in range(nz):
                k = i * (nz + 1) + j; faces.append((k, k + 1, k + 1 + layer, k + layer))
        obj = b.mesh(name, verts, faces, ocean, parent); obj.data.materials.append(belly)
        for p in obj.data.polygons:
            p.use_smooth = True; p.material_index = 1 if nx * nz <= p.index < 2 * nx * nz else 0
        return obj
    # A thick static pod hides the seam where the two wings meet on the centreline.
    b.sphere('Body pod', (0, .015, .20), (.235, .145, .68), ocean, root)
    b.sphere('Rear body', (0, .01, -.56), (.115, .065, .20), ocean, root)
    b.sphere('Head', (0, .02, .53), (.36, .15, .33), ocean, root)
    b.sphere('Brow', (0, .075, .40), (.28, .112, .25), ocean, root)
    b.sphere('Jaw', (0, -.088, .755), (.245, .040, .125), belly, root)
    b.sphere('Mouth', (0, -.062, .805), (.235, .030, .042), dark, root)
    b.sphere('Belly plate', (0, -.055, .16), (.20, .085, .55), belly, root)
    for side in (-1, 1):
        p = pivot(b, root, 'WingPivot')
        wing('Wing', min(0, side), max(0, side), p)
        for i in range(5):
            # Five gill slits per side, angled back across the pale underside.
            u = side * (.10 + i * .031); v = .30 + i * .045
            b.line('Gill slit', [(lambda q: (q[0], q[1] - .007, q[2]))(manta_surf(u + side * .052 * k / 4, v + .048 * k / 4, True)) for k in range(5)], dark, p, .012)
        if tier >= 2:
            b.line('Wing edge', [manta_surf(side * (.06 + .82 * k / 14), .020, False) for k in range(15)], mottle, p, .006)
            b.line('Wing trail', [manta_surf(side * (.10 + .76 * k / 14), .975, False) for k in range(15)], mottle, p, .005)
            for i in range(12 if tier == 2 else 26):
                # An R2 low-discrepancy scatter; a plain multiple of one constant lines the spots up.
                q = manta_surf(side * (.13 + .70 * ((i * .7548776662) % 1)), .14 + .68 * ((i * .5698402909) % 1), False)
                b.sphere('Wing fleck', (q[0], q[1] + .003, q[2]), (.030, .008, .030), mottle, p, *b.LEVEL['tiny'])
        hinge(b, p, 'WingMesh', (0, 0, 0), [(1, 0), (7, -.16 * side), (13, 0), (19, .13 * side), (25, 0)] if tier >= 2 else None)
    for side in (-1, 1):
        # Cephalic lobes curl forward off the mouth corners instead of jutting out square.
        path = []; rad = []
        for k in range(7):
            t = k / 6
            path.append((side * (.19 + .13 * t + .05 * t * t), .03 - .10 * t * t, .70 + .40 * t - .06 * t * t)); rad.append(.085 - .052 * t ** .9)
        tube(b, 'Cephalic lobe', path, rad, ocean, root, seg)
        b.line('Eye ridge', [(side * .31, .085, .48), (side * .335, .125, .58), (side * .30, .105, .68)], rim, root, .014)
    sheet(b, 'Dorsal', [(0, .09, -.40), (0, .26, -.53), (0, .34, -.66), (0, .16, -.70), (0, .045, -.60)], ocean, rim, root, .018)
    if tier == 3:
        for side in (-1, 1):
            b.sphere('Secondary eye sparkle', (side * .478, .078, .723), (.013, .019, .017), cream, root, *b.LEVEL['small'])
        glossy()
    return rays


def manta_tail(b, parent, tier, base, edge, rays):
    seg = 6 + 2 * tier; n = 10 + 4 * tier
    path = []; rad = []
    for k in range(n + 1):
        t = k / n
        path.append((0, .005 + .10 * t ** 1.4 - .02 * t, -.66 - 1.12 * t)); rad.append(.062 * (1 - t) ** .75 + .008)
    tube(b, 'Whip tail', path, rad, base, parent, seg)
    if tier >= 2:
        taper(b.line('Caudal barb', [(0, .045, -.80), (0, .13, -.90), (0, .17, -1.02)], base, parent, .026), .10)
        b.line('Tail keel', [(0, -.03 + .008 * k, -.70 - .09 * k) for k in range(7)], rays, parent, .008)


def shark_shell(side, y, z, push=.008):
    return (side * (.34 * math.sqrt(max(.004, 1 - (y / .40) ** 2 - (z / 1.08) ** 2)) + push), y, z)


def shark(b, root, tier, palette):
    slate, cream, dark, silver = palette['Slate'], palette['Pearl'], palette['Ink'], palette['Moonlight']
    drop(root, 'Dorsal', 'Second dorsal', 'Pectoral', 'Pelvic', 'Gill', 'Grin')
    rays = b.mat('Shark fin sheen', (.44, .53, .61), .32)
    pale = b.mat('Shark underside', (.80, .85, .87), .44)
    steel = b.mat('Shark steel', (.16, .22, .29), .42)
    # Blunt snout with an underslung jaw, so the grin reads as a mouth rather than a scratch.
    b.sphere('Snout', (0, .035, .80), (.245, .20, .255), slate, root)
    b.sphere('Nose tip', (0, -.02, .92), (.135, .105, .14), slate, root)
    b.sphere('Jaw', (0, -.195, .85), (.185, .055, .16), cream, root)
    # The grin wraps the flank corners up toward the eyes, so it still reads from above.
    def grin(t, d=0.):
        z = .74 + .21 * (1 - t * t); a = -math.pi / 2 + t * 1.15
        r = math.sqrt(max(.004, 1 - (z / 1.08) ** 2))
        return ((.34 * r + .009) * math.cos(a), (.40 * r + .009) * math.sin(a) - d, z)
    b.line('Grin', [grin(-1 + k / 5) for k in range(11)], dark, root, .015)
    for side in (-1, 1):
        for i in range(5):
            z = .44 - i * .095
            pts = [shark_shell(side, .17 - .09 * k, z - .012 * k, .010) for k in range(5)]
            b.line('Gill slit', pts, dark, root, .009 if tier == 3 else .011)
            if tier >= 2:
                b.line('Gill rim', [shark_shell(side, y, zz - .024, .013) for _, y, zz in pts], rays, root, .006)
        if tier >= 2:
            b.line('Lateral line', [shark_shell(side, -.02 - .055 * math.sin(k / 9 * math.pi), .58 - k * .16, .007) for k in range(10)], rays, root, .007)
        if tier == 3:
            for row in range(4):
                for c in range(7):
                    p = shark_shell(side, .23 - row * .115, .38 - c * .185 + (row % 2) * .09, .004)
                    b.line('Denticle', [p, (p[0], p[1] - .010, p[2] - .05)], steel, root, .0035)
    if tier == 3:
        for i in range(11): b.sphere('Tooth', grin(-.90 + i * .18, .034), (.015, .021, .013), cream, root, *b.LEVEL['tiny'])
    sheet(b, 'Dorsal', [(0, .34, .30), (.02, .60, .14), (.035, .90, -.20), (.03, 1.00, -.36), (0, .84, -.40), (-.01, .54, -.30), (0, .34, -.22)], slate, dark, root, .026)
    sheet(b, 'Second dorsal', [(0, .19, -.68), (.015, .34, -.82), (.02, .42, -.94), (0, .30, -.96), (0, .16, -.90)], slate, dark, root, .018)
    sheet(b, 'Anal', [(0, -.20, -.72), (0, -.34, -.86), (0, -.40, -.98), (0, -.26, -.98), (0, -.16, -.90)], slate, dark, root, .016)
    for side in (-1, 1):
        sheet(b, 'Pelvic', [(side * .13, -.32, -.30), (side * .26, -.44, -.48), (side * .34, -.52, -.62), (side * .22, -.40, -.60), (side * .12, -.32, -.48)], slate, dark, root, .014)
        # Long swept pectoral scythes ride their own hinges for a slow rigid tilt.
        p = pivot(b, root, 'PectoralPivot'); anchor = (side * .28, -.16, .36)
        sheet(b, 'Pectoral', [anchor, (side * .33, -.25, .12), (side * .64, -.35, -.10), (side * .99, -.45, -.34), (side * 1.07, -.47, -.44), (side * .87, -.41, -.36), (side * .53, -.29, -.16), (side * .30, -.20, .06)], slate, dark, p, .020)
        if tier >= 2:
            for i in range(3 + tier):
                t = i / (2 + tier)
                b.line('Pectoral ray', [(side * .32, -.19, .28 - .10 * t), (side * (.55 + .18 * t), -.29 - .04 * t, .02 - .14 * t), (side * (.80 + .18 * t), -.38 - .04 * t, -.20 - .16 * t)], rays, p, .006)
        hinge(b, p, 'PectoralMesh', anchor, [(1, 0), (7, -.11 * side), (13, 0), (19, .09 * side), (25, 0)] if tier >= 2 else None)
    if tier == 3: glossy()
    return rays


def shark_tail(b, parent, tier, base, edge, rays):
    seg = 6 + 2 * tier; n = 6 + 2 * tier
    # The peduncle carries the rear body into the tail so the whole stern flexes together.
    path = []; rad = []
    for k in range(n + 1):
        t = k / n
        path.append((0, .02 * t, -.78 - .34 * t)); rad.append(.055 + .175 * (1 - t) ** .8)
    tube(b, 'Peduncle', path, rad, base, parent, seg, shape=lambda a: 1 - .14 * math.cos(a) ** 2)
    out = [(0, .10, -.96), (.02, .34, -1.14), (.04, .66, -1.44), (.05, .92, -1.74), (.03, .98, -1.82), (0, .80, -1.80),
           (0, .46, -1.55), (0, .20, -1.36), (0, .10, -1.44), (0, -.16, -1.60), (0, -.36, -1.68), (0, -.40, -1.62),
           (0, -.26, -1.44), (0, -.10, -1.20), (0, -.08, -1.00)]
    sheet(b, 'Caudal fin', out, base, edge, parent, .024)
    # Rays fan from the peduncle to a fraction of the outline, so none can escape the blade.
    root_pt = (0, .02, -1.00)
    def spoke(edge, t, f):
        n = len(edge) - 1; i = min(n - 1, int(t * n)); u = t * n - i
        q = [edge[i][m] + (edge[i + 1][m] - edge[i][m]) * u for m in range(3)]
        return tuple(root_pt[m] + f * (q[m] - root_pt[m]) for m in range(3))
    upper = [(0, .10, -.96), (.02, .34, -1.14), (.04, .66, -1.44), (.03, .98, -1.82)]
    lower = [(0, -.08, -1.00), (0, -.10, -1.20), (0, -.26, -1.44), (0, -.38, -1.64)]
    c = 4 if tier == 1 else 7 if tier == 2 else 11
    for side in (-1, 1):
        for i in range(c):
            t = .12 + .88 * i / (c - 1)
            b.line('Caudal ray', [(side * .024, .04, -1.00), spoke(upper, t, .48), spoke(upper, t, .86)], rays, parent, .006)
        for i in range(2 if tier == 1 else 4):
            t = .25 + .75 * i / (1 if tier == 1 else 3)
            b.line('Lower caudal ray', [(side * .024, -.02, -1.02), spoke(lower, t, .50), spoke(lower, t, .84)], rays, parent, .006)
        if tier >= 2:
            b.line('Caudal edge', [(x + side * .016, y * .96, z - (z + 1.28) * .035) for x, y, z in out[3:12]], edge, parent, .009)
            b.line('Caudal keel', [(side * .10, .02, -.92), (side * .13, .03, -1.02), (side * .09, .04, -1.10)], rays, parent, .010)
