"""Lift UI development fixtures out of a generated project.

    python tools/export_fixtures.py [project.eote]

The web UI has to be buildable on a machine with no EcoStruxure installation -
a Mac, say. These fixtures are our own generated output rather than anything
shipped by the product, so they are safe to commit, and because they come from
the file that actually opens in OTE, a canvas that renders them correctly
renders the real thing correctly.
"""

import io
import json
import os
import sqlite3
import sys
import tempfile
import zipfile

OUT = os.path.join("web", "src", "fixtures")


def write(name, payload):
    path = os.path.join(OUT, name)
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(payload, indent=1) + "\n")
    return path


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "demo_project/HMICopilot_PumpStation.eote"
    os.makedirs(OUT, exist_ok=True)

    with zipfile.ZipFile(src) as z:
        entry = next(i.filename for i in z.infolist()
                     if i.filename.replace("\\", "/").endswith("Screen.dat"))
        screen = json.loads(z.read(entry).decode("utf-8-sig"))
        graph = json.loads(z.read("Bindings.dat").decode("utf-8-sig"))

        tmp = tempfile.mkdtemp()
        rows = {}
        for db, sql, key in (
            ("Variables.db",
             'SELECT "Name","DataType","Comments" FROM Variables ORDER BY rowid', "variables"),
            ("Alarm.db",
             'SELECT "Message","AlarmType","AlarmRecordType","Severity","Value"'
             ' FROM Alarm ORDER BY rowid', "alarms"),
        ):
            local = os.path.join(tmp, db)
            open(local, "wb").write(z.read(db))
            con = sqlite3.connect(local)
            rows[key] = con.execute(sql).fetchall()
            con.close()

    write("pump-station.screen.json", screen)
    write("pump-station.bindings.json", graph)
    write("pump-station.project.json", {
        "variables": [
            {"Name": n, "DataType": t, "Comments": c, "DeviceAddress": ""}
            for n, t, c in rows["variables"]
        ],
        "alarms": [
            {"Message": m, "AlarmType": at, "AlarmRecordType": ar,
             "Severity": s, "Value": v}
            for m, at, ar, s, v in rows["alarms"]
        ],
    })

    print("wrote fixtures from", src,
          "-", len(screen["Children"][0]["Children"]), "objects,",
          len(graph["Bindings"]), "bindings,",
          len(rows["variables"]), "tags,",
          len(rows["alarms"]), "alarms")


if __name__ == "__main__":
    main()
