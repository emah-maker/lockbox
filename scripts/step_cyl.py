import re, sys

def load(path):
    ents = {}
    with open(path, "r", errors="ignore") as f:
        txt = f.read()
    for m in re.finditer(r"#(\d+)\s*=\s*([A-Z_0-9]+)\s*\((.*?)\)\s*;", txt, re.S):
        ents[int(m.group(1))]=(m.group(2), m.group(3))
    return ents
def refs(b): return [int(x) for x in re.findall(r"#(\d+)", b)]
def nums(b):
    return [float(m.group(1)) for m in re.finditer(r"(-?\d+\.\d+(?:[eE][+-]?\d+)?|-?\d+\.)", b)]

path=sys.argv[1]
E=load(path)
def point(e):
    if e in E and E[e][0]=="CARTESIAN_POINT": return nums(E[e][1])[:3]
def direction(e):
    if e in E and E[e][0]=="DIRECTION": return nums(E[e][1])[:3]
print("CYLINDERS (posts/holes) — id, radius, axisdir, location")
rows=[]
for eid,(typ,body) in E.items():
    if typ!="CYLINDRICAL_SURFACE": continue
    r=nums(body)
    rad=r[-1] if r else None
    pl=refs(body)
    ax2=pl[0]
    a2=refs(E[ax2][1])
    loc=point(a2[0]); axis=direction(a2[1]) if len(a2)>1 else None
    rows.append((rad,loc,axis))
rows.sort(key=lambda t:(round(t[0],2), t[1][2] if t[1] else 0))
for rad,loc,axis in rows:
    if loc is None: continue
    a="?" if not axis else "XYZ"[max(range(3),key=lambda i:abs(axis[i]))]
    print(f"  r={rad:6.3f} d={rad*2:6.3f} axis={a}  loc=({loc[0]:7.2f},{loc[1]:6.2f},{loc[2]:7.2f})")
