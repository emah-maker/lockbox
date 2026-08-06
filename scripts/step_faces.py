import re, sys, math

def load(path):
    ents = {}
    with open(path, "r", errors="ignore") as f:
        txt = f.read()
    # join multiline entities: each ends with ;
    for m in re.finditer(r"#(\d+)\s*=\s*([A-Z_0-9]+)\s*\((.*?)\)\s*;", txt, re.S):
        eid = int(m.group(1)); typ = m.group(2); body = m.group(3)
        ents[eid] = (typ, body)
    return ents

def refs(body):
    return [int(x) for x in re.findall(r"#(\d+)", body)]

def nums(body):
    # numbers not preceded by # (avoid ids)
    out=[]
    for m in re.finditer(r"(-?\d+\.\d+(?:[eE][+-]?\d+)?|-?\d+\.)", body):
        out.append(float(m.group(1)))
    return out

def main(path):
    E = load(path)
    def point(eid):
        typ,body=E[eid]
        if typ=="CARTESIAN_POINT":
            return nums(body)[:3]
        return None
    def direction(eid):
        typ,body=E[eid]
        if typ=="DIRECTION":
            return nums(body)[:3]
        return None
    # gather vertices reachable from a face's bounds
    def face_vertices(fid):
        typ,body=E[fid]
        vids=set()
        stack=refs(body)
        seen=set()
        while stack:
            r=stack.pop()
            if r in seen or r not in E: continue
            seen.add(r)
            t,b=E[r]
            if t=="CARTESIAN_POINT":
                vids.add(r); continue
            stack.extend(refs(b))
        return [point(v) for v in vids if point(v)]

    planes=[]  # (normal_axis, coord, extents dict)
    for eid,(typ,body) in E.items():
        if typ!="ADVANCED_FACE": continue
        rs=refs(body)
        surf=None
        for r in rs:
            if r in E and E[r][0] in ("PLANE","CYLINDRICAL_SURFACE","CONICAL_SURFACE"):
                surf=r; break
        if surf is None: continue
        stype=E[surf][0]
        if stype!="PLANE": continue
        # plane placement: AXIS2_PLACEMENT_3D(location, axis(normal), refdir)
        pl=refs(E[surf][1])
        if not pl: continue
        ax2=pl[0]
        a2refs=refs(E[ax2][1])
        loc=point(a2refs[0]) if a2refs else None
        norm=direction(a2refs[1]) if len(a2refs)>1 else None
        if norm is None or loc is None: continue
        # classify normal axis
        ax=max(range(3), key=lambda i: abs(norm[i]))
        if abs(norm[ax])<0.99:
            axis_name="tilt"
        else:
            axis_name="XYZ"[ax]
        verts=face_vertices(eid)
        if not verts: continue
        xs=[v[0] for v in verts]; ys=[v[1] for v in verts]; zs=[v[2] for v in verts]
        area_extent=((min(xs),max(xs)),(min(ys),max(ys)),(min(zs),max(zs)))
        coord=loc[ax]
        planes.append((axis_name, ax, coord, area_extent, len(verts)))
    # report planes normal to Y (horizontal shelves) sorted by coord
    print("="*70); print(path)
    for want,label in (("Y","HORIZONTAL shelves (normal=Y=depth)"),
                       ("X","walls normal=X"),("Z","walls normal=Z")):
        print(f"\n--- {label} ---")
        sub=[p for p in planes if p[0]==want]
        sub.sort(key=lambda p:p[2])
        for axis_name,ax,coord,ext,nv in sub:
            (xr,yr,zr)=ext
            dx=xr[1]-xr[0]; dy=yr[1]-yr[0]; dz=zr[1]-zr[0]
            print(f"  {want}={coord:8.2f}  X[{xr[0]:7.2f},{xr[1]:7.2f}]({dx:6.1f})  "
                  f"Y[{yr[0]:6.2f},{yr[1]:6.2f}]  Z[{zr[0]:7.2f},{zr[1]:7.2f}]({dz:6.1f})  v={nv}")

for p in sys.argv[1:]:
    main(p)
