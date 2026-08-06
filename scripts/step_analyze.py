import re, sys, collections

def parse_points(path):
    pts = []
    rx = re.compile(r"CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)")
    with open(path, "r", errors="ignore") as f:
        txt = f.read()
    for m in rx.finditer(txt):
        nums = [float(x) for x in m.group(1).split(",")]
        if len(nums) == 3:
            pts.append(tuple(nums))
    return pts

def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))

def hist(vals, nbins=40):
    lo, hi = min(vals), max(vals)
    span = hi - lo or 1
    counts = [0]*nbins
    for v in vals:
        i = min(nbins-1, int((v-lo)/span*nbins))
        counts[i]+=1
    return lo, hi, span, counts

def show(path):
    pts = parse_points(path)
    print("="*60)
    print(path, " points:", len(pts))
    (xr,yr,zr) = bbox(pts)
    for name, r in (("X",xr),("Y",yr),("Z",zr)):
        print(f"  {name}: {r[0]:9.3f} .. {r[1]:9.3f}   span={r[1]-r[0]:8.3f}")
    for axis, name in ((0,"X"),(1,"Y"),(2,"Z")):
        vals=[p[axis] for p in pts]
        lo,hi,span,counts=hist(vals, 30)
        print(f"  --- {name} histogram (lo={lo:.2f} hi={hi:.2f}) ---")
        mx=max(counts) or 1
        for i,c in enumerate(counts):
            edge=lo+span*i/30
            bar="#"*int(40*c/mx)
            if c: print(f"    {edge:8.2f} | {c:3d} {bar}")
    return pts

for p in sys.argv[1:]:
    show(p)
