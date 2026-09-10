"""
Generate importable EcoStruxure Operator Terminal Expert compound objects (.co).

This is the reference implementation of HMI Copilot's artifact packager. It reads a
shipped library object as a structural template, rewrites its identity, colours and
geometry, and repacks it as a valid .co archive.

Two details matter and are easy to get wrong:
  * archive entry names use BACKSLASH separators ("Localization\\en-US.dat"),
    matching what OTE itself writes
  * the three SQLite files are copied verbatim, never regenerated - generated
    objects declare no local variables or converters, so the empty databases from
    the template are correct as-is

Usage:  python tools/make_demo_co.py [output_dir]
"""

import copy
import json
import os
import shutil
import sys
import uuid
import zipfile
from datetime import datetime, timezone

LIBRARY = (
    r"C:\Program Files\Schneider Electric"
    r"\EcoStruxure Operator Terminal Expert 4.4\Buildtime\TemplateCOs\COs.pkg"
)

APP_VERSION = "4.4.20.0"

# Colours are plain 0xRRGGBB integers.
def rgb(hex_string):
    return int(hex_string.lstrip("#"), 16)

SE_GREEN = rgb("#3DCD58")
DEEP_GREEN = rgb("#0F7B3E")
WATER_BLUE = rgb("#1B7FD4")
DEEP_BLUE = rgb("#0B3F73")
AMBER = rgb("#E3A008")
DEEP_AMBER = rgb("#8A5D00")
SLATE = rgb("#D9D9D9")
DARK_SLATE = rgb("#5A6673")


def load_library(pkg_path):
    """Return {object_name: {entry_name: bytes}} for every object in COs.pkg."""
    objects = {}
    with zipfile.ZipFile(pkg_path) as pkg:
        for name in pkg.namelist():
            if not name.endswith(".co"):
                continue
            raw = pkg.read(name)
            tmp = os.path.join(os.environ.get("TEMP", "."), f"_co_{uuid.uuid4().hex}.zip")
            with open(tmp, "wb") as fh:
                fh.write(raw)
            try:
                with zipfile.ZipFile(tmp) as co:
                    entries = {e: co.read(e) for e in co.namelist()}
                objdef = json.loads(entries["CompoundObject.objdef"])
                objects[objdef["Name"]] = entries
            finally:
                os.remove(tmp)
    return objects


def recolour(node, mapping):
    """Walk any nested structure and remap every colour integer found."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "Value" and isinstance(value, int) and value in mapping:
                node[key] = mapping[value]
            else:
                recolour(value, mapping)
    elif isinstance(node, list):
        for item in node:
            recolour(item, mapping)
    return node


def derive(template, name, description, colours=None, screen_edit=None):
    """Build a new object's entry dict from a template object's entries."""
    entries = {k: v for k, v in template.items()}

    old_id = json.loads(entries["CompoundObject.objdef"])["Id"]
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def reidentify(text):
        return text.replace(old_id, new_id).replace(old_id.upper(), new_id.upper())

    # --- objdef -----------------------------------------------------------
    objdef = json.loads(reidentify(entries["CompoundObject.objdef"].decode("utf-8")))
    objdef["Name"] = name
    objdef["Id"] = new_id
    objdef["CommitId"] = str(uuid.uuid4()).upper()
    objdef["ModifiedDate"] = now
    objdef["ModifiedAppVersion"] = APP_VERSION
    entries["CompoundObject.objdef"] = json.dumps(objdef, indent=2).encode("utf-8")

    # --- Screen.dat -------------------------------------------------------
    screen = json.loads(reidentify(entries["Screen.dat"].decode("utf-8")))
    old_subtype = screen.get("SubType")
    screen["Name"] = name
    screen["SubType"] = name
    screen["Description"] = description
    # every inner object gets a fresh id too, so two derived objects never collide
    def refresh_ids(node, remap):
        if isinstance(node, dict):
            if "UniqueId" in node and node["UniqueId"] != new_id:
                fresh = str(uuid.uuid4())
                remap[node["UniqueId"]] = fresh
                node["UniqueId"] = fresh
            for value in node.values():
                refresh_ids(value, remap)
        elif isinstance(node, list):
            for item in node:
                refresh_ids(item, remap)
        return remap

    remap = refresh_ids(screen, {})
    if colours:
        recolour(screen, colours)
    if screen_edit:
        screen_edit(screen, new_id)
    entries["Screen.dat"] = json.dumps(screen, indent=2).encode("utf-8")

    # --- Bindings.dat -----------------------------------------------------
    bindings_text = reidentify(entries["Bindings.dat"].decode("utf-8"))
    for old, fresh in remap.items():
        bindings_text = bindings_text.replace(old, fresh).replace(old.upper(), fresh.upper())
    if old_subtype:
        bindings_text = bindings_text.replace(f'"{old_subtype}"', f'"{name}"')
    entries["Bindings.dat"] = bindings_text.encode("utf-8")

    # --- localisation -----------------------------------------------------
    for entry in list(entries):
        if entry.startswith("Localization") and entry.endswith("en-US.dat"):
            loc = json.loads(entries[entry])
            loc.setdefault("TypeLocalizationInfo", {})["Description"] = description
            entries[entry] = json.dumps(loc, indent=2).encode("utf-8")

    # Converters.db / LocalVariables.db / Validations.db pass through untouched.
    return entries


def write_co(entries, path):
    """Repack entries as a .co archive, preserving OTE's backslash entry names."""
    order = [
        "Bindings.dat",
        "CompoundObject.objdef",
        "CompoundObjectSettings.dat",
        "Converters.db",
        "LocalVariables.db",
        "Properties.propDef",
        "Resources.dat",
        "Screen.dat",
        "Validations.db",
    ]
    names = [n for n in order if n in entries]
    names += sorted(n for n in entries if n not in names)
    stamp = datetime.now().timetuple()[:6]

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as out:
        for name in names:
            # OTE writes nested paths with backslashes. ZipInfo's constructor
            # rewrites os.sep to "/", so set the filename after construction.
            info = zipfile.ZipInfo(name.replace("\\", "/"), date_time=stamp)
            info.filename = name.replace("/", "\\")
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            out.writestr(info, entries[name])
    return path


# --------------------------------------------------------------------------
# The three demo objects
# --------------------------------------------------------------------------

def add_backing_panel(screen, co_id):
    """Insert an unbound Rectangle behind the existing artwork.

    Adding a child is safe: Bindings.dat addresses targets by UniqueId, not by
    position, so an unbound sibling cannot disturb the existing wiring.
    """
    grid = screen["Children"][0]
    while grid.get("Type") != "Grid" and grid.get("Children"):
        grid = grid["Children"][0]
    rows = len(grid.get("Rows") or []) or 10
    cols = len(grid.get("Columns") or []) or 8
    panel = {
        "Type": "Rectangle",
        "UniqueId": str(uuid.uuid4()),
        "Name": "Panel_Background",
        "Fill": {
            "Type": 1,
            "Color": {"ColorIndexEnabled": False, "Value": rgb("#EFF3F6")},
            "@StructBindingValue": None,
        },
        "Border": {
            "Type": 1,
            "Color": {"ColorIndexEnabled": False, "Value": DARK_SLATE},
            "@StructBindingValue": None,
        },
        "Location": {"RowSpan": rows, "ColumnSpan": cols},
    }
    grid["Children"].insert(0, panel)


def build(library, out_dir):
    made = []

    # 1 - safest possible proof: a recoloured, re-identified vertical bar.
    made.append(write_co(
        derive(
            library["BarGraph_Vert_50"],
            name="HMICopilot_TankLevel",
            description="Generated by HMI Copilot - tank level indicator (vertical fill)",
            colours={45136: WATER_BLUE, 34342: DEEP_BLUE, 14277081: SLATE},
        ),
        os.path.join(out_dir, "HMICopilot_TankLevel.co"),
    ))

    # 2 - different template, proving the packager generalises.
    made.append(write_co(
        derive(
            library["Gauge_20"],
            name="HMICopilot_PumpSpeed",
            description="Generated by HMI Copilot - pump speed gauge (0-100%)",
            colours={45136: AMBER, 34342: DEEP_AMBER, 14277081: SLATE},
        ),
        os.path.join(out_dir, "HMICopilot_PumpSpeed.co"),
    ))

    # 3 - genuine composition: an extra child we authored ourselves.
    made.append(write_co(
        derive(
            library["BarGraph_Horiz_10"],
            name="HMICopilot_FlowTile",
            description="Generated by HMI Copilot - flow tile with backing panel",
            colours={45136: SE_GREEN, 20480: DEEP_GREEN, 34342: DEEP_GREEN},
            screen_edit=add_backing_panel,
        ),
        os.path.join(out_dir, "HMICopilot_FlowTile.co"),
    ))
    return made


def verify(path):
    """Re-open a generated .co and assert it parses the way OTE expects."""
    with zipfile.ZipFile(path) as co:
        names = co.namelist()
        objdef = json.loads(co.read("CompoundObject.objdef"))
        screen = json.loads(co.read("Screen.dat"))
        bindings = json.loads(co.read("Bindings.dat"))
        meta = json.loads(co.read("_metadata"))
    assert objdef["Id"] == screen["UniqueId"], "objdef Id must match Screen UniqueId"
    assert objdef["Name"] == screen["Name"], "objdef Name must match Screen Name"
    # Python's zipfile normalises separators when reading, so check the stored
    # bytes directly rather than namelist().
    with open(path, "rb") as fh:
        blob = fh.read()
    assert b"Localization" + b"\\" in blob, "nested entries must use backslashes"
    assert b"Localization/" not in blob, "nested entries must not use forward slashes"
    ids = set()

    def collect(node):
        if isinstance(node, dict):
            if "UniqueId" in node:
                ids.add(node["UniqueId"])
            for v in node.values():
                collect(v)
        elif isinstance(node, list):
            for i in node:
                collect(i)

    collect(screen)
    missing = [
        t["ObjectId"]
        for t in bindings.get("Targets", [])
        if t.get("ParentIds") and t["ObjectId"] not in ids
    ]
    assert not missing, f"binding targets not present in Screen.dat: {missing}"
    return {
        "name": objdef["Name"],
        "id": objdef["Id"],
        "entries": len(names),
        "objects": len(ids),
        "bindings": len(bindings.get("Bindings", [])),
        "encryption": meta.get("EncryptionInfo"),
        "size": os.path.getsize(path),
    }


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "demo_objects"
    os.makedirs(out_dir, exist_ok=True)
    library = load_library(LIBRARY)
    print(f"Loaded {len(library)} template objects from the shipped library\n")
    for path in build(library, out_dir):
        info = verify(path)
        print(f"  {os.path.basename(path):<32} {info['size']:>6} bytes  "
              f"{info['objects']} objects  {info['bindings']} bindings  "
              f"encryption={info['encryption']}")
    print(f"\nWrote {len(os.listdir(out_dir))} files to {os.path.abspath(out_dir)}")
