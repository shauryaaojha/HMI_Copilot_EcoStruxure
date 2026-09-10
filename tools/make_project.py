"""
Generate a complete, openable EcoStruxure Operator Terminal Expert project (.eote).

This is the upgraded artifact packager. Instead of emitting compound objects for an
engineer to import and drag onto a screen, it writes the whole project: tags in
Variables.db, laid-out screens under Screens/, and the tag bindings that wire them
together. The engineer opens the file and the HMI is already built.

It also sidesteps the compound-object licence gate entirely, because it never
creates a compound object - it places primitive parts directly on a screen, which
is how screens are normally authored.

Structure of a .eote (all ZIP entries, nested paths use BACKSLASH separators):

    Project.dat, Target.dat, _metadata, ...      JSON
    Variables.db, Alarm.db, Recipe.db, ...       SQLite
    Bindings.dat                                 JSON - Sources / Targets / Bindings
    Screens\\Hierarchy.dat                        JSON - screen order
    Screens\\<guid>\\Screen.dat                    JSON - the object tree
    Screens\\<guid>\\Metadata.dat                  JSON - name, Id, ObjectType 9, Order
    Screens\\<guid>\\LocalVariables.db             SQLite

Usage:  python tools/make_project.py [output_dir]
"""

import json
import os
import sqlite3
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone

TEMPLATES = (
    r"C:\Program Files\Schneider Electric"
    r"\EcoStruxure Operator Terminal Expert 4.4\Buildtime\BuildtimeData\ProjectTemplates"
)
BLANK = os.path.join(TEMPLATES, "Blank.eote")
DONOR = os.path.join(TEMPLATES, "Sample - Alarm 1.eote")   # source of LocalVariables.db

SCREEN_W, SCREEN_H = 1024, 600

# Palette "Green-Simple" (ColorSet 4). Indices, not RGB - screens use the project palette.
BLACK, WHITE, GREY = 31, 21, 11
INK, PAPER, GREEN = 1, 2, 3
RED, DARK_GREY, DARK_GREEN = 5, 22, 43

FONT = {"Type": {"Type": 2, "Value": "0", "DisplayValue": "0"}}


def gid():
    return str(uuid.uuid4())


# --------------------------------------------------------------------------
# the equipment we are generating for
# --------------------------------------------------------------------------

TAGS = [
    ("PMP_101_RUN", "BOOL", "Pump 1 running"),
    ("PMP_101_FLT", "BOOL", "Pump 1 fault"),
    ("PMP_102_RUN", "BOOL", "Pump 2 running"),
    ("PMP_102_FLT", "BOOL", "Pump 2 fault"),
    ("FT_101_PV",   "REAL", "Flow, LPM"),
    ("LT_101_PV",   "REAL", "Tank level, percent"),
    ("LT_101_HI",   "BOOL", "Tank high level"),
]

INITIAL = {"BOOL": "false", "REAL": "0", "INT": "0", "DINT": "0", "WORD": "0"}

# Alarms. A bit alarm fires on a BOOL going true; a level alarm fires when a
# numeric tag crosses a threshold. AlarmType 1=HiHi 2=Hi 3=Lo 4=LoLo,
# AlarmRecordType 1=bit 2=level - both read off the shipped Alarm sample.
ALARMS = [
    # (tag, message, kind, level, threshold, severity)
    ("PMP_101_FLT", "Pump 1 fault",            "bit",   "HiHi", "0",  5),
    ("PMP_102_FLT", "Pump 2 fault",            "bit",   "HiHi", "0",  5),
    ("LT_101_HI",   "Tank high level",         "bit",   "HiHi", "0",  3),
    ("LT_101_PV",   "Tank level high",         "level", "Hi",   "85", 3),
    ("LT_101_PV",   "Tank level critically high", "level", "HiHi", "95", 5),
]

ALARM_GROUP = "AlarmGroup1"
LEVEL_CODE = {"HiHi": 1, "Hi": 2, "Lo": 3, "LoLo": 4}


# --------------------------------------------------------------------------
# part builders - shapes copied from what the shipped projects actually contain
# --------------------------------------------------------------------------

def textbox(name, text, left, top, width, height, size=12, colour=INK, bold=False):
    node = {
        "Type": "TextBox", "UniqueId": gid(), "Name": name, "Text": text,
        "TextColor": {"Color": {"Value": colour}},
        "Font": dict(FONT, Size=size),
        "TextLayout": {"HorizontalAlignment": 1, "VerticalAlignment": 64},
        "Location": {"Left": left, "Top": top}, "Width": width, "Height": height,
    }
    if bold:
        node["Font"]["Bold"] = True
    return node


def rectangle(name, left, top, width, height, fill=PAPER, border=GREY):
    return {
        "Type": "Rectangle", "UniqueId": gid(), "Name": name,
        "Fill": {"Color": {"Value": fill}},
        "Border": {"Color": {"Value": border}}, "Thickness": 1,
        "Location": {"Left": left, "Top": top}, "Width": width, "Height": height,
    }


def lamp(name, off_text, on_text, left, top, width, height):
    face = lambda text, fg, bg, bd: {
        "TextColor": {"Color": {"Value": fg}}, "Text": text,
        "Font": dict(FONT, Size=13), "TextLayout": {"Wrap": True},
        "Fill": {"Color": {"Value": bg}}, "Border": {"Color": {"Value": bd}}, "Thickness": 1,
    }
    return {
        "Type": "Lamp", "UniqueId": gid(), "Name": name,
        "Off": face(off_text, INK, GREY, DARK_GREY),
        "On": face(on_text, WHITE, GREEN, DARK_GREEN),
        "Location": {"Left": left, "Top": top}, "Width": width, "Height": height,
    }


def alarm_lamp(name, off_text, on_text, left, top, width, height):
    face = lambda text, fg, bg, bd: {
        "TextColor": {"Color": {"Value": fg}}, "Text": text,
        "Font": dict(FONT, Size=13), "TextLayout": {"Wrap": True},
        "Fill": {"Color": {"Value": bg}}, "Border": {"Color": {"Value": bd}}, "Thickness": 1,
    }
    return {
        "Type": "Lamp", "UniqueId": gid(), "Name": name,
        "Off": face(off_text, INK, GREY, DARK_GREY),
        "On": face(on_text, WHITE, RED, DARK_GREY),
        "Location": {"Left": left, "Top": top}, "Width": width, "Height": height,
    }


def numeric(name, left, top, width, height, decimals=1):
    return {
        "Type": "NumericDisplay", "UniqueId": gid(), "Name": name,
        "CurrentValue": 0, "DecimalDigits": decimals,
        "TextColor": {"Color": {"Value": INK}}, "Font": dict(FONT, Size=20),
        "Fill": {"Color": {"Value": WHITE}},
        "Border": {"Color": {"Value": DARK_GREY}}, "Thickness": 1,
        "TextLayout": {"HorizontalAlignment": 4, "VerticalAlignment": 64},
        "Location": {"Left": left, "Top": top}, "Width": width, "Height": height,
    }


def alarm_summary(name, left, top, width, height):
    return {
        "Type": "AlarmSummary", "UniqueId": gid(), "Name": name,
        "Location": {"Left": left, "Top": top}, "Width": width, "Height": height,
    }


# --------------------------------------------------------------------------
# screen composition
# --------------------------------------------------------------------------

def build_screen(name, full=True):
    """Return (screen_json, [(part, tag_name, property, mode), ...])."""
    parts, wiring = [], []

    parts.append(rectangle("Banner", 0, 0, SCREEN_W, 56, fill=GREEN, border=GREEN))
    parts.append(textbox("Title", "Pump Station 1", 20, 14, 420, 30,
                         size=20, colour=WHITE, bold=True))
    parts.append(textbox("Subtitle", "Generated by HMI Copilot", 700, 20, 300, 24,
                         size=11, colour=WHITE))

    # --- pumps ------------------------------------------------------------
    parts.append(rectangle("Panel_Pumps", 20, 76, 480, 224))
    parts.append(textbox("Lbl_Pumps", "PUMPS", 36, 88, 200, 22, size=12, colour=DARK_GREY))

    for i, (tag_run, tag_flt, label) in enumerate([
        ("PMP_101_RUN", "PMP_101_FLT", "PUMP 1"),
        ("PMP_102_RUN", "PMP_102_FLT", "PUMP 2"),
    ]):
        x = 40 + i * 230
        if full:
            run = lamp(f"Lamp_{label.replace(' ', '')}_RUN", f"{label}\nSTOPPED",
                       f"{label}\nRUNNING", x, 120, 200, 76)
            parts.append(run)
            wiring.append((run, tag_run, "CurrentValue", 2))

            flt = alarm_lamp(f"Lamp_{label.replace(' ', '')}_FLT", "OK", "FAULT",
                             x, 208, 200, 60)
            parts.append(flt)
            wiring.append((flt, tag_flt, "CurrentValue", 2))
        else:
            parts.append(rectangle(f"Box_{label.replace(' ', '')}", x, 120, 200, 76))
            parts.append(textbox(f"Lbl_{label.replace(' ', '')}", label, x + 10, 140, 180, 30))

    # --- process values ---------------------------------------------------
    parts.append(rectangle("Panel_Process", 520, 76, 484, 224))
    parts.append(textbox("Lbl_Process", "PROCESS", 536, 88, 200, 22, size=12, colour=DARK_GREY))

    for i, (tag, label, unit) in enumerate([
        ("FT_101_PV", "Flow", "LPM"),
        ("LT_101_PV", "Level", "%"),
    ]):
        y = 124 + i * 84
        parts.append(textbox(f"Lbl_{label}", label, 540, y + 14, 120, 28, size=14))
        if full:
            nd = numeric(f"Num_{label}", 670, y, 200, 60)
            parts.append(nd)
            wiring.append((nd, tag, "CurrentValue", 2))
        else:
            parts.append(rectangle(f"Box_{label}", 670, y, 200, 60, fill=WHITE))
        parts.append(textbox(f"Unit_{label}", unit, 884, y + 14, 100, 28,
                             size=14, colour=DARK_GREY))

    # --- alarms -----------------------------------------------------------
    parts.append(textbox("Lbl_Alarms", "ACTIVE ALARMS", 20, 316, 300, 24,
                         size=12, colour=DARK_GREY))
    if full:
        parts.append(alarm_summary("AlarmBanner", 20, 344, 984, 236))
    else:
        parts.append(rectangle("Panel_Alarms", 20, 344, 984, 236))

    screen_id = gid()
    screen = {
        "Type": "Screen", "UniqueId": screen_id, "Name": name,
        "Children": [{
            "Type": "ViewBox", "UniqueId": gid(), "Name": "ViewBox",
            "Options": 108, "Width": SCREEN_W, "Height": SCREEN_H,
            "Children": parts,
        }],
    }
    return screen, wiring


# --------------------------------------------------------------------------
# variables + bindings
# --------------------------------------------------------------------------

def write_variables(db_bytes, tags):
    """Insert the tags into a copy of the template Variables.db."""
    path = os.path.join(tempfile.gettempdir(), f"vars_{uuid.uuid4().hex}.db")
    with open(path, "wb") as fh:
        fh.write(db_bytes)
    ids = {}
    con = sqlite3.connect(path)
    try:
        con.execute("DELETE FROM Variables")
        cols = [c[1] for c in con.execute("pragma table_info('Variables')")]
        for order, (name, dtype, comment) in enumerate(tags, start=1):
            unique = str(uuid.uuid4()).upper()
            ids[name] = unique
            row = {
                "UniqueId": unique, "DataType": dtype, "Type": 1, "IsArray": 0,
                "Dimension": None, "EnableVariableLength": 0, "Size": 0,
                "InitialValue": INITIAL.get(dtype, "0"), "InputRange": 0,
                "Min": "", "Max": "", "Comments": comment, "Value": None,
                "Order": order, "ParentId": None, "Name": name, "id": -1,
                "FolderId": None, "RootParentId": None, "Retentive": 0,
                "DataSharing": 0, "StringEncode": 0, "DeviceAddress": "",
                "BaseAddress": 0, "IsSymbolVariable": 0,
            }
            # "Order" is a SQL keyword, so every column name is quoted.
            quoted = ",".join(f'"{c}"' for c in cols)
            con.execute(
                f"INSERT INTO Variables ({quoted}) VALUES ({','.join('?' * len(cols))})",
                [row.get(c) for c in cols],
            )
        con.commit()
    finally:
        con.close()
    with open(path, "rb") as fh:
        blob = fh.read()
    os.remove(path)
    return blob, ids


def write_alarms(db_bytes, alarms):
    """Insert an alarm group and its alarms. Returns (blob, [(uid, fullname, subtype, tag)])."""
    path = os.path.join(tempfile.gettempdir(), f"alarm_{uuid.uuid4().hex}.db")
    with open(path, "wb") as fh:
        fh.write(db_bytes)
    made = []
    con = sqlite3.connect(path)
    try:
        con.execute("DELETE FROM Alarm")
        con.execute("DELETE FROM AlarmGroup")
        group_uid = str(uuid.uuid4()).upper()
        gcols = [c[1] for c in con.execute("pragma table_info('AlarmGroup')")]
        grow = {
            "UniqueId": group_uid, "Order": 1, "Name": ALARM_GROUP, "Id": 3,
            "Parameter": 0, "ActiveLabel": "Active", "ACKLabel": "Ack",
            "RTNLabel": "Return", "HiHiLabel": "HiHi", "HiLabel": "Hi",
            "LoLabel": "Lo", "LoLoLabel": "LoLo", "Enable": 0,
            "CurrentActiveCount": 0, "CurrentRtnCount": 0, "CurrentAckCount": 0,
            "CurrentLogCount": 0, "CumulativeActiveCount": 0,
            "UNACKLabel": "UnAck", "CurrentUnAckCount": 0, "AlarmBehavior": 0,
        }
        con.execute(
            f"INSERT INTO AlarmGroup ({','.join(f'\"{c}\"' for c in gcols)}) "
            f"VALUES ({','.join('?' * len(gcols))})",
            [grow.get(c) for c in gcols],
        )

        acols = [c[1] for c in con.execute("pragma table_info('Alarm')")]
        for order, (tag, message, kind, level, value, severity) in enumerate(alarms):
            uid = str(uuid.uuid4()).upper()
            name = f"Alarm{order + 1}"
            arow = {
                "UniqueId": uid, "AlarmGroupId": group_uid,
                "AlarmType": LEVEL_CODE[level],
                "AlarmRecordType": 1 if kind == "bit" else 2,
                "Id": order + 1, "IsOnTrigger": 1 if kind == "bit" else 0,
                "Message": message, "Order": order, "Parameter": 0,
                "Severity": severity, "Value": value, "Deadband": 0,
            }
            con.execute(
                f"INSERT INTO Alarm ({','.join(f'\"{c}\"' for c in acols)}) "
                f"VALUES ({','.join('?' * len(acols))})",
                [arow.get(c) for c in acols],
            )
            made.append((uid, f"{ALARM_GROUP}.{name}.{level}",
                         "BoolAlarm" if kind == "bit" else "LevelAlarm", tag))
        con.commit()
    finally:
        con.close()
    with open(path, "rb") as fh:
        blob = fh.read()
    os.remove(path)
    return blob, made


def build_bindings(screen_id, wiring, var_ids, alarms=()):
    """Wire tags to part properties, in the Sources / Targets / Bindings shape."""
    sources, targets, bindings = [], [], []
    src_index = {}
    for part, tag, prop, mode in wiring:
        if tag not in src_index:
            src_index[tag] = len(sources)
            sources.append({
                "ObjectType": 4, "ReferenceId": len(sources),
                "ObjectId": var_ids[tag], "ObjectFullName": tag,
            })
        t = len(targets)
        targets.append({
            "ObjectType": 8, "SubType": part["Type"], "ReferenceId": t,
            "ObjectId": part["UniqueId"], "ParentIds": screen_id.upper(),
            "ScreenId": screen_id, "ObjectFullName": part["Name"],
        })
        bindings.append({
            "Type": 2, "Mode": mode, "BindingText": f"{tag}.Value",
            "ConverterId": None, "ConverterName": None,
            "Target": t, "TargetProperty": prop, "Sources": str(src_index[tag]),
        })

    # Alarms bind to their trigger tag by name, not by value: the target is the
    # alarm row itself (ObjectType 30) and the property is VariableName.
    for uid, full_name, subtype, tag in alarms:
        if tag not in src_index:
            src_index[tag] = len(sources)
            sources.append({
                "ObjectType": 4, "ReferenceId": len(sources),
                "ObjectId": var_ids[tag], "ObjectFullName": tag,
            })
        t = len(targets)
        targets.append({
            "ObjectType": 30, "SubType": subtype, "ReferenceId": t,
            "ObjectId": uid, "ObjectFullName": full_name,
        })
        bindings.append({
            "Type": 2, "Mode": 1, "BindingText": tag,
            "ConverterId": None, "ConverterName": None,
            "Target": t, "TargetProperty": "VariableName",
            "Sources": str(src_index[tag]),
        })

    return {"Sources": sources, "Targets": targets, "Bindings": bindings}


# --------------------------------------------------------------------------
# packaging
# --------------------------------------------------------------------------

def read_entries(path):
    with zipfile.ZipFile(path) as z:
        return {i.filename: z.read(i.filename) for i in z.infolist()}


def write_eote(entries, path):
    """Write the archive via a temporary file, so a project still open in
    EcoStruxure fails with a clear message instead of a half-written file."""
    stamp = datetime.now().timetuple()[:6]
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name.replace("\\", "/"), date_time=stamp)
            info.filename = name.replace("/", "\\")     # OTE's own convention
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            out.writestr(info, data)
    try:
        os.replace(tmp, path)
    except PermissionError:
        os.remove(tmp)
        raise SystemExit(
            f"\n  Cannot overwrite {path}\n"
            f"  It is open in EcoStruxure Operator Terminal Expert. "
            f"Close the project and run again.\n")
    return path


def jdump(obj):
    return json.dumps(obj, indent=2).encode("utf-8")


def build(out_path, screen_name="PumpStation1", full=True):
    entries = read_entries(BLANK)
    donor = read_entries(DONOR)

    local_vars = next(v for k, v in donor.items()
                      if k.replace("\\", "/").startswith("Screens/")
                      and k.endswith("LocalVariables.db"))

    var_blob, var_ids = write_variables(entries["Variables.db"], TAGS)
    entries["Variables.db"] = var_blob

    alarms = ()
    if full:
        alarm_blob, alarms = write_alarms(entries["Alarm.db"], ALARMS)
        entries["Alarm.db"] = alarm_blob

    screen, wiring = build_screen(screen_name, full=full)
    sid = screen["UniqueId"]

    entries["Screens\\Hierarchy.dat"] = jdump([{"ObjectId": sid, "Children": []}])
    entries[f"Screens\\{sid}\\Screen.dat"] = jdump(screen)
    entries[f"Screens\\{sid}\\Metadata.dat"] = jdump({
        "LayoutType": 8, "Id": 1, "ObjectType": 9, "Name": screen_name, "Order": 0,
    })
    entries[f"Screens\\{sid}\\LocalVariables.db"] = local_vars

    entries["Bindings.dat"] = jdump(build_bindings(sid, wiring, var_ids, alarms))

    # Blank.eote carries neither of these, but every shipped sample project does,
    # and OTE creates Contents\Hierarchy.dat itself on first save when it is
    # absent - so write what a real project looks like instead of leaving the
    # product to repair ours.
    entries.setdefault("GlobalScripts.dat", b"[]")
    entries.setdefault("Contents\\Hierarchy.dat", b"[]")

    project = json.loads(entries["Project.dat"])
    project["UniqueId"] = gid()
    project["RuntimeProjectId"] = gid()
    project["ModifiedDateTime"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    project["VersionModified"] = "4.4.0.0"
    entries["Project.dat"] = jdump(project)

    write_eote(entries, out_path)
    return out_path, len(TAGS), len(wiring), len(alarms)


def verify(path):
    with zipfile.ZipFile(path) as z:
        names = [i.filename for i in z.infolist()]
        screens = [n for n in names if n.replace("\\", "/").endswith("Screen.dat")]
        assert screens, "project contains no screen"
        raw = z.read(screens[0])
        screen = json.loads(raw)
        binds = json.loads(z.read("Bindings.dat"))
        json.loads(z.read("Project.dat"))
    with open(path, "rb") as fh:
        blob = fh.read()
    assert b"Screens" + b"\\" in blob, "nested entries must use backslashes"
    assert b"Screens/" not in blob, "nested entries must not use forward slashes"

    count = [0]
    def walk(n):
        count[0] += 1
        for c in n.get("Children") or []:
            walk(c)
    walk(screen)
    return {"objects": count[0], "bindings": len(binds["Bindings"]),
            "entries": len(names), "size": os.path.getsize(path)}


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "demo_project"
    os.makedirs(out_dir, exist_ok=True)
    for fname, full in (("HMICopilot_PumpStation.eote", True),
                        ("HMICopilot_Minimal.eote", False)):
        path, tags, wires, alarms = build(os.path.join(out_dir, fname), full=full)
        info = verify(path)
        print(f"  {fname:<32} {info['size']:>7} bytes  {info['objects']:>3} objects  "
              f"{tags} tags  {alarms} alarms  {info['bindings']} bindings")
    print(f"\nWrote to {os.path.abspath(out_dir)}")
