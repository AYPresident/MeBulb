# -*- coding: utf-8 -*-
# MeBulb equipment export for Revit.
#
# Writes "MeBulb equipment.json" with the plan outline and clearance zones of mechanical equipment
# (AHUs, FCUs, condensers...) so MeBulb can place them to scale on PDF drawings.
#
# How to run (any one of these):
#   - Dynamo: open "MeBulb equipment export.dyn" and press Run, or paste this file into a Python Script node.
#   - pyRevit: save it as a pushbutton script (script.py) and click the button.
#   - RevitPythonShell: open and run it.
# Open a floor plan view first. Select the units to export; with nothing selected, every mechanical
# equipment instance visible in the view is exported (one entry per family type).
#
# Coordinates are millimetres in each family's own axes (x right, y up the plan). Geometry on
# subcategories whose names contain clear / service / access / maint / airflow / discharge / intake /
# exhaust becomes a clearance zone; everything else visible in the plan is the unit's outline.
# Length parameters whose names mention clearance, service or access are exported as well.
import clr, json, os
clr.AddReference('RevitAPI')
from Autodesk.Revit.DB import *

doc = None; uidoc = None
try:  # Dynamo
    clr.AddReference('RevitServices')
    from RevitServices.Persistence import DocumentManager
    doc = DocumentManager.Instance.CurrentDBDocument
    uidoc = DocumentManager.Instance.CurrentUIApplication.ActiveUIDocument
except Exception:
    pass
if doc is None:
    try:  # pyRevit / RevitPythonShell
        uidoc = __revit__.ActiveUIDocument
        doc = uidoc.Document
    except Exception:
        raise Exception('Run this inside Revit: Dynamo, pyRevit or RevitPythonShell')

FT = 304.8  # Revit's internal feet to millimetres
ZONE_WORDS = ('clear', 'service', 'access', 'maint', 'airflow', 'air flow', 'discharge', 'intake', 'exhaust', 'inlet', 'outlet')

def r1(v):
    return round(v * 10.0) / 10.0

def style_name(obj):
    try:
        gs = doc.GetElement(obj.GraphicsStyleId)
        if gs is None:
            return ''
        cat = gs.GraphicsStyleCategory
        name = cat.Name if cat is not None else gs.Name
        if cat is not None and cat.Parent is not None:
            name = cat.Parent.Name + ' / ' + name
        return name or ''
    except Exception:
        return ''

def is_zone(name):
    n = (name or '').lower()
    for w in ZONE_WORDS:
        if w in n:
            return True
    return False

def walk(geo, inv, out, name=''):
    # out: { 'lines': [[(x, y)...]], 'zones': { name: [(x, y)...] } }
    if geo is None:
        return
    for obj in geo:
        nm = style_name(obj) or name
        if isinstance(obj, GeometryInstance):
            walk(obj.GetInstanceGeometry(), inv, out, nm)
            continue
        pts_list = []
        if isinstance(obj, Solid):
            if obj.Volume <= 0 and obj.Faces.Size == 0:
                continue
            for e in obj.Edges:
                pts_list.append(list(e.Tessellate()))
        elif isinstance(obj, Curve):
            pts_list.append(list(obj.Tessellate()))
        elif isinstance(obj, PolyLine):
            pts_list.append(list(obj.GetCoordinates()))
        elif isinstance(obj, Mesh):
            for i in range(obj.NumTriangles):
                t = obj.get_Triangle(i)
                pts_list.append([t.get_Vertex(0), t.get_Vertex(1), t.get_Vertex(2), t.get_Vertex(0)])
        for pts in pts_list:
            local = [inv.OfPoint(p) for p in pts]
            xy = [(r1(p.X * FT), r1(p.Y * FT)) for p in local]
            if is_zone(nm):
                out['zones'].setdefault(nm, []).extend(xy)
            elif len(xy) > 1:
                out['lines'].append(xy)

def bbox_rect(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return [[min(xs), min(ys)], [max(xs), min(ys)], [max(xs), max(ys)], [min(xs), max(ys)]]

def param_values(el):
    vals = {}
    for p in el.Parameters:
        try:
            name = p.Definition.Name
            if p.StorageType == StorageType.String:
                if name in ('Manufacturer', 'Model', 'Description', 'Type Mark', 'Type Comments') and p.AsString():
                    vals[name] = p.AsString()
                continue
            if p.StorageType != StorageType.Double:
                continue
            is_len = True
            try:
                is_len = p.Definition.GetDataType() == SpecTypeId.Length
            except Exception:
                pass
            low = name.lower()
            if is_len and (is_zone(low) or low in ('width', 'depth', 'length', 'height') or 'width' in low or 'depth' in low or 'height' in low):
                vals[name] = r1(p.AsDouble() * FT)
        except Exception:
            pass
    return vals

view = doc.ActiveView
ids = list(uidoc.Selection.GetElementIds()) if uidoc is not None else []
if ids:
    elems = [doc.GetElement(i) for i in ids]
else:
    elems = list(FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_MechanicalEquipment).WhereElementIsNotElementType())
elems = [e for e in elems if isinstance(e, FamilyInstance)]

items = []; seen = set()
for inst in elems:
    sym = inst.Symbol
    fam = sym.Family.Name
    typ = sym.get_Parameter(BuiltInParameter.SYMBOL_NAME_PARAM).AsString()
    key = fam + '|' + typ
    if key in seen:
        continue
    seen.add(key)
    inv = inst.GetTransform().Inverse
    out = {'lines': [], 'zones': {}}
    o1 = Options(); o1.View = view                      # what the plan shows
    walk(inst.get_Geometry(o1), inv, out)
    o2 = Options(); o2.DetailLevel = ViewDetailLevel.Fine; o2.IncludeNonVisibleObjects = True   # hidden clearance solids
    hidden = {'lines': [], 'zones': {}}
    walk(inst.get_Geometry(o2), inv, hidden)
    for nm in hidden['zones']:
        if nm not in out['zones']:
            out['zones'][nm] = hidden['zones'][nm]
    if not out['lines']:
        out['lines'] = hidden['lines']
    body_pts = [p for l in out['lines'] for p in l]
    params = {}
    params.update(param_values(sym)); params.update(param_values(inst))
    hgt = 0.0
    try:
        bb = inst.get_BoundingBox(None)
        if bb is not None:
            hgt = r1((bb.Max.Z - bb.Min.Z) * FT)
    except Exception:
        pass
    item = {
        'name': fam + ': ' + typ, 'family': fam, 'type': typ,
        'category': inst.Category.Name if inst.Category is not None else '',
        'maker': params.get('Manufacturer', ''), 'model': params.get('Model', '') or typ,
        'h': hgt,
        'body': bbox_rect(body_pts) if body_pts else [],
        'lines': [[list(p) for p in l] for l in out['lines'][:4000]],
        'zones': [{'kind': nm, 'label': nm.split(' / ')[-1], 'poly': bbox_rect(pts)} for nm, pts in out['zones'].items() if len(pts) > 1],
        'params': params,
    }
    items.append(item)

result = {'app': 'MeBulb', 'kind': 'equipment', 'version': 1, 'units': 'mm',
          'source': 'Revit ' + doc.Application.VersionNumber + ' - ' + (doc.Title or ''), 'items': items}
folder = os.path.dirname(doc.PathName) if doc.PathName else os.path.join(os.path.expanduser('~'), 'Documents')
path = os.path.join(folder, 'MeBulb equipment.json')
f = open(path, 'w')   # plain ASCII JSON (non-ASCII names are escaped), the same on IronPython and CPython
try:
    f.write(json.dumps(result, indent=1))
finally:
    f.close()
OUT = '%d unit type(s) written to %s' % (len(items), path)
try:
    print(OUT)
except Exception:
    pass
