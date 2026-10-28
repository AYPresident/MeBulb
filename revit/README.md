# Revit exporter for MeBulb equipment

`mebulb_export_equipment.py` reads mechanical equipment families in a Revit model and writes
`MeBulb equipment.json` (plan outline, linework, clearance zones and clearance parameters of each
family type, in millimetres). MeBulb imports that file into its equipment library
(Equipment panel ▸ Import), and the units can then be placed to scale on any PDF drawing.

MeBulb also offers the script, and a Dynamo graph that wraps it, from Equipment ▸ ⋯ ▸ Download the
Revit exporter. The graph is generated from this file at build time.

Run it from Dynamo (a Python Script node, CPython3 or PythonNet3), pyRevit or RevitPythonShell, with a
floor plan open. Select the units to export, or select nothing to export every mechanical equipment
instance in the view. The model is not changed.

Clearance zones are recognised by subcategory names containing clear, service, access, maint,
airflow, discharge, intake, exhaust, inlet or outlet (including geometry hidden in plan views).
Length parameters whose names mention clearance, service or access are exported too; MeBulb uses
"Front/Back/Left/Right … Clearance" style parameters when the family has no clearance geometry.
