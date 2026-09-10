"""Render a generated .eote screen to PNG, straight from its Screen.dat.

This is the poster child for the claim in SOLUTION.md 3.4: the JSON that becomes
the project file is the same JSON that drives the preview. Nothing here knows
anything about the pump station - it walks whatever object tree it is handed.

    python tools/render_screen.py demo_project/HMICopilot_PumpStation.eote assets

writes screen_design.png (as OTE opens it) and screen_live.png (values driven).
"""

import json
import os
import sys
import zipfile
from PIL import Image, ImageDraw, ImageFont

SCALE = 2
F = "C:/Windows/Fonts/"

# ColorSet 4 "Green-Simple" from Buildtime/CommonScripts/Colors/Colors.lua
PALETTE = {
    1: 0x030303, 2: 0xF1F1F1, 3: 0x00B050, 4: 0xF9A605, 5: 0xF77A84,
    6: 0x3B70DE, 7: 0x4CC5BF, 8: 0xB5C801, 9: 0xC98C4A, 10: 0xAC97E1,
    11: 0xD9D9D9, 12: 0x303030, 13: 0x57FFA7, 14: 0xFFFD5C, 15: 0xFFD1DB,
    16: 0x92C7FF, 17: 0xA3FFFF, 18: 0xFFFF58, 19: 0xFFE3A1, 20: 0xFFEEFF,
    21: 0xFFFFFF, 22: 0x515151, 23: 0x2ADA7A, 24: 0xFFD02F, 25: 0xFFA4AE,
    31: 0x000000, 32: 0x262626, 33: 0x009A3A, 42: 0x313131, 43: 0x008626,
    45: 0xCD505A, 51: 0x05952C, 52: 0x474747,
}

# Values the simulator pushes in the "live" rendering, keyed by object name.
LIVE = {
    "Lamp_PUMP1_RUN": True, "Lamp_PUMP1_FLT": False,
    "Lamp_PUMP2_RUN": False, "Lamp_PUMP2_FLT": True,
    "Num_Flow": 62.4, "Num_Level": 91.8,
}
LIVE_ALARMS = [
    ("10:14:22", "PMP_102_FLT", "Pump 2 fault", "5", "ACTIVE"),
    ("10:14:19", "LT_101_PV", "Tank level high", "3", "ACTIVE"),
]
ALARM_COLS = ["TIME", "VARIABLE", "MESSAGE", "SEV", "STATE"]
ALARM_XS = [0.02, 0.14, 0.34, 0.72, 0.84]


def rgb(index, fallback=0x000000):
    v = PALETTE.get(index, fallback)
    return ((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)


def colour_of(node, key, fallback=0x000000):
    """Resolve {"Fill": {"Color": {"Value": n}}} to an RGB tuple."""
    try:
        return rgb(node[key]["Color"]["Value"], fallback)
    except (KeyError, TypeError):
        return ((fallback >> 16) & 0xFF, (fallback >> 8) & 0xFF, fallback & 0xFF)


def face(size, bold=False):
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(F + name, max(1, int(size * SCALE)))


def place(d, text, font, box, halign=1, valign=64, fill=(0, 0, 0)):
    """Draw text inside box honouring OTE's alignment flags."""
    x0, y0, x1, y1 = box
    lines = text.split("\n")
    lh = d.textbbox((0, 0), "Ag", font=font)[3]
    total = lh * len(lines)
    ty = y0 + (y1 - y0 - total) / 2 if valign == 64 else y0
    for i, line in enumerate(lines):
        w = d.textbbox((0, 0), line, font=font)[2]
        if halign == 4:                       # right
            tx = x1 - w - 8 * SCALE
        elif halign == 2:                     # centre
            tx = x0 + (x1 - x0 - w) / 2
        else:                                 # left
            tx = x0 + 8 * SCALE
        d.text((tx, ty + i * lh), line, font=font, fill=fill)


def box_of(node):
    loc = node.get("Location", {})
    x = loc.get("Left", 0) * SCALE
    y = loc.get("Top", 0) * SCALE
    return [x, y, x + node.get("Width", 0) * SCALE, y + node.get("Height", 0) * SCALE]


def font_of(node, default=12):
    f = node.get("Font", {}) or {}
    return face(f.get("Size", default), f.get("Bold", False))


def draw_alarm_summary(d, node, live):
    x0, y0, x1, y1 = box_of(node)
    d.rectangle([x0, y0, x1, y1], fill=rgb(21), outline=rgb(22), width=SCALE)
    head = 30 * SCALE
    d.rectangle([x0, y0, x1, y0 + head], fill=rgb(22))
    hf, rf = face(11, True), face(11)
    for col, frac in zip(ALARM_COLS, ALARM_XS):
        d.text((x0 + (x1 - x0) * frac, y0 + 7 * SCALE), col, font=hf, fill=rgb(21))
    rows = LIVE_ALARMS if live else []
    for i, row in enumerate(rows):
        ry = y0 + head + i * 30 * SCALE
        d.rectangle([x0 + SCALE, ry, x1 - SCALE, ry + 30 * SCALE], fill=(255, 236, 236))
        for cell, frac in zip(row, ALARM_XS):
            d.text((x0 + (x1 - x0) * frac, ry + 7 * SCALE), cell, font=rf, fill=rgb(45))
    if not rows:
        place(d, "No active alarms", face(12), [x0, y0 + head, x1, y1],
              halign=2, fill=rgb(22))


def draw(d, node, live):
    t = node.get("Type")
    name = node.get("Name", "")

    if t in ("Screen", "ViewBox"):
        for child in node.get("Children", []) or []:
            draw(d, child, live)
        return

    box = box_of(node)

    if t == "Rectangle":
        d.rectangle(box, fill=colour_of(node, "Fill", 0xFFFFFF),
                    outline=colour_of(node, "Border", 0x515151), width=SCALE)

    elif t == "TextBox":
        layout = node.get("TextLayout", {}) or {}
        place(d, node.get("Text", ""), font_of(node), box,
              layout.get("HorizontalAlignment", 1), layout.get("VerticalAlignment", 64),
              colour_of(node, "TextColor"))

    elif t == "Lamp":
        state = node["On"] if (live and LIVE.get(name)) else node["Off"]
        d.rectangle(box, fill=colour_of(state, "Fill", 0xD9D9D9),
                    outline=colour_of(state, "Border", 0x515151), width=2 * SCALE)
        place(d, state.get("Text", ""), font_of(state, 13), box, 2, 64,
              colour_of(state, "TextColor"))

    elif t == "NumericDisplay":
        d.rectangle(box, fill=colour_of(node, "Fill", 0xFFFFFF),
                    outline=colour_of(node, "Border", 0x515151), width=SCALE)
        value = LIVE.get(name, node.get("CurrentValue", 0)) if live else node.get("CurrentValue", 0)
        text = f"{float(value):.{node.get('DecimalDigits', 0)}f}"
        layout = node.get("TextLayout", {}) or {}
        place(d, text, font_of(node, 20), box,
              layout.get("HorizontalAlignment", 4), 64, colour_of(node, "TextColor"))

    elif t == "AlarmSummary":
        draw_alarm_summary(d, node, live)

    for child in node.get("Children", []) or []:
        draw(d, child, live)


def load_screen(eote):
    with zipfile.ZipFile(eote) as z:
        entry = next(i.filename for i in z.infolist()
                     if i.filename.replace("\\", "/").endswith("Screen.dat"))
        return json.loads(z.read(entry).decode("utf-8-sig"))


def render(screen, live, path):
    view = screen["Children"][0]
    w, h = view.get("Width", 1024) * SCALE, view.get("Height", 600) * SCALE
    img = Image.new("RGB", (w, h), rgb(2))
    d = ImageDraw.Draw(img)
    draw(d, screen, live)
    d.rectangle([0, 0, w - 1, h - 1], outline=rgb(22), width=SCALE)
    img.save(path, "PNG", dpi=(220, 220))
    return path


def main():
    eote = sys.argv[1] if len(sys.argv) > 1 else "demo_project/HMICopilot_PumpStation.eote"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "assets"
    os.makedirs(outdir, exist_ok=True)
    screen = load_screen(eote)
    for live, name in ((False, "screen_design.png"), (True, "screen_live.png")):
        print("wrote", render(screen, live, os.path.join(outdir, name)))


if __name__ == "__main__":
    main()
