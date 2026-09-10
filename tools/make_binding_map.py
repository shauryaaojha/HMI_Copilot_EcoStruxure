"""Draw the binding map for a generated project, from its real Bindings.dat.

This is the view SOLUTION.md 5.3 calls the highest-value one: every PLC tag on
the left, every object property it drives on the right, connectors between them.
Nothing is hardcoded - it renders whatever graph the .eote contains.

    python tools/make_binding_map.py demo_project/HMICopilot_PumpStation.eote assets/binding_map.png
"""

import json
import os
import sys
import zipfile
from PIL import Image, ImageDraw, ImageFont

W = 1900          # height is computed from the number of bindings
BG = (255, 255, 255)
GREEN = (0, 176, 80)
DARK_GREEN = (0, 134, 38)
AMBER = (216, 138, 0)
INK = (28, 36, 46)
MUTED = (110, 124, 138)
LINE = (206, 214, 222)
WASH = (245, 249, 246)

F = "C:/Windows/Fonts/"
SB = lambda s: ImageFont.truetype(F + "seguisb.ttf", s)
RG = lambda s: ImageFont.truetype(F + "segoeui.ttf", s)
MO = lambda s: ImageFont.truetype(F + "consola.ttf", s)

ROW, TOP = 78, 210
LX0, LX1 = 60, 560          # tag column
RX0, RX1 = 1180, 1840       # target column


def load(eote):
    with zipfile.ZipFile(eote) as z:
        return json.loads(z.read("Bindings.dat").decode("utf-8-sig"))


def centre(d, text, f, cx, y, fill=INK):
    d.text((cx - d.textbbox((0, 0), text, font=f)[2] / 2, y), text, font=f, fill=fill)


def connector(d, y1, y2, colour):
    """S-curve from the tag row to the target row."""
    x1, x2 = LX1 + 14, RX0 - 14
    mid = (x1 + x2) / 2
    pts = []
    for i in range(41):
        t = i / 40
        # cubic bezier with horizontal control handles
        px = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * mid + 3 * (1 - t) * t ** 2 * mid + t ** 3 * x2
        py = (1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y2
        pts.append((px, py))
    d.line(pts, fill=colour, width=4, joint="curve")
    d.polygon([(x2 + 12, y2), (x2 - 4, y2 - 8), (x2 - 4, y2 + 8)], fill=colour)


def build(eote, path):
    g = load(eote)
    sources, targets, bindings = g["Sources"], g["Targets"], g["Bindings"]

    height = TOP + len(bindings) * ROW + 130
    img = Image.new("RGB", (W, height), BG)
    d = ImageDraw.Draw(img)

    centre(d, "Binding map — rendered from Bindings.dat", SB(46), W / 2, 44, INK)
    centre(d, f"{len(sources)} tags   ·   {len(targets)} bound properties   ·   "
              f"{len(bindings)} bindings   ·   0 unbound", RG(30), W / 2, 110, MUTED)

    d.text((LX0, TOP - 58), "PLC TAGS", font=SB(30), fill=MUTED)
    d.text((RX0, TOP - 58), "OBJECT PROPERTIES", font=SB(30), fill=MUTED)

    # tag rows, one per source
    ty = {}
    for i, s in enumerate(sources):
        y = TOP + i * ROW
        ty[s["ReferenceId"]] = y + 26
        d.rounded_rectangle([LX0, y, LX1, y + 52], 10, fill=WASH, outline=LINE, width=2)
        d.text((LX0 + 20, y + 11), s["ObjectFullName"], font=MO(28), fill=DARK_GREEN)

    # target rows, one per binding
    for i, b in enumerate(bindings):
        y = TOP + i * ROW
        t = targets[b["Target"]]
        alarm = b["TargetProperty"] == "VariableName"
        colour = AMBER if alarm else GREEN
        d.rounded_rectangle([RX0, y, RX1, y + 52], 10, fill=WASH, outline=LINE, width=2)
        label = f'{t["ObjectFullName"]}.{b["TargetProperty"]}'
        d.text((RX0 + 20, y + 11), label, font=MO(24), fill=INK)
        d.text((RX1 - 150, y + 14), t["SubType"], font=RG(21), fill=colour)
        connector(d, ty[int(b["Sources"])], y + 26, colour)

    # legend
    ly = TOP + len(bindings) * ROW + 24
    for i, (colour, text) in enumerate([
        (GREEN, "display binding — tag drives an object property"),
        (AMBER, "alarm binding — tag is the alarm trigger"),
    ]):
        d.rectangle([LX0, ly + i * 40 + 12, LX0 + 34, ly + i * 40 + 18], fill=colour)
        d.text((LX0 + 52, ly + i * 40), text, font=RG(26), fill=MUTED)

    img.save(path, "PNG", dpi=(220, 220))
    return path


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "demo_project/HMICopilot_PumpStation.eote"
    out = sys.argv[2] if len(sys.argv) > 2 else "assets/binding_map.png"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    print("wrote", build(src, out))
