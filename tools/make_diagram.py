"""Render the HMI Copilot pipeline diagram for the submission poster."""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1760, 1120
BG = (255, 255, 255)
GREEN = (61, 205, 88)
DARK_GREEN = (15, 123, 62)
INK = (28, 36, 46)
MUTED = (108, 122, 137)
LINE = (203, 213, 222)
WASH = (243, 248, 244)

F = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(F + name, size)


SB = lambda s: font("seguisb.ttf", s)   # semibold
RG = lambda s: font("segoeui.ttf", s)   # regular
MO = lambda s: font("consola.ttf", s)   # mono


def rrect(d, box, r, fill=None, outline=None, width=3):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def centre(d, text, f, cx, y, fill=INK):
    w = d.textbbox((0, 0), text, font=f)[2]
    d.text((cx - w / 2, y), text, font=f, fill=fill)


def arrow(d, x1, x2, y, colour=GREEN, thick=7):
    head = 26
    d.line([(x1, y), (x2 - head, y)], fill=colour, width=thick)
    d.polygon([(x2, y), (x2 - head, y - 15), (x2 - head, y + 15)], fill=colour)


def bullets(d, items, x, y, f, step, dot=GREEN):
    """Draw a bullet list. An item starting with a space is a continuation
    line: it is indented to align with the text above and gets no dot."""
    for i, text in enumerate(items):
        yy = y + i * step
        if text.startswith(" "):
            d.text((x + 26, yy), text.lstrip(), font=f, fill=INK)
        else:
            d.ellipse([x, yy + 13, x + 10, yy + 23], fill=dot)
            d.text((x + 26, yy), text, font=f, fill=INK)


def build(path):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    top, bot = 120, 830

    # ---- inputs -----------------------------------------------------------
    ax0, ax1 = 20, 440
    rrect(d, [ax0, 250, ax1, 700], 18, fill=WASH, outline=LINE, width=3)
    centre(d, "INPUTS", SB(38), (ax0 + ax1) / 2, 285, MUTED)
    bullets(d, ["PLC tag export", "Plain-English intent", "Company standards"],
            ax0 + 34, 378, RG(33), 82)

    arrow(d, ax1 + 24, 530, 475)

    # ---- the product ------------------------------------------------------
    bx0, bx1 = 540, 1190
    rrect(d, [bx0, top, bx1, bot], 22, fill=(255, 255, 255), outline=GREEN, width=6)
    d.rounded_rectangle([bx0, top, bx1, top + 96], radius=22, fill=GREEN)
    d.rectangle([bx0, top + 60, bx1, top + 96], fill=GREEN)
    centre(d, "HMI COPILOT", SB(52), (bx0 + bx1) / 2, top + 22, (255, 255, 255))

    bullets(d, [
        "1  Parse and normalise tags",
        "2  Infer equipment",
        "3  Select HMI components",
        "4  Lay out the screens",
        "5  Generate alarms + bindings",
        "6  Validate against standards",
        "7  Stream onto a live canvas",
    ], bx0 + 40, top + 122, RG(33), 62)

    d.line([(bx0 + 30, bot - 132), (bx1 - 30, bot - 132)], fill=LINE, width=3)
    centre(d, "Engineer inspects, edits and approves", RG(34), (bx0 + bx1) / 2, bot - 110, MUTED)
    centre(d, "every element before export", RG(34), (bx0 + bx1) / 2, bot - 68, MUTED)

    arrow(d, bx1 + 24, 1256, 475)

    # ---- outputs ----------------------------------------------------------
    cx0, cx1 = 1266, 1740
    rrect(d, [cx0, 250, cx1, 700], 18, fill=WASH, outline=LINE, width=3)
    centre(d, "NATIVE ARTIFACTS", SB(38), (cx0 + cx1) / 2, 285, MUTED)
    for i, (name, note) in enumerate([
        ("project.eote", "opens in EcoStruxure OTE"),
        ("validation.html", "sign-off report"),
    ]):
        yy = 410 + i * 96
        d.ellipse([cx0 + 36, yy + 13, cx0 + 46, yy + 23], fill=GREEN)
        d.text((cx0 + 62, yy - 4), name, font=MO(32), fill=DARK_GREEN)
        d.text((cx0 + 62, yy + 34), note, font=RG(26), fill=MUTED)

    # ---- the punchline ----------------------------------------------------
    y0 = 900
    rrect(d, [20, y0, W - 20, y0 + 170], 18, fill=(240, 250, 243), outline=GREEN, width=4)
    centre(d, "AI proposes.  You see.  You decide.",
           SB(46), W / 2, y0 + 28, DARK_GREEN)
    centre(d, "A complete HMI — in one file that opens in EcoStruxure Operator Terminal Expert",
           RG(34), W / 2, y0 + 96, MUTED)

    img.save(path, "PNG", dpi=(400, 400))
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/pipeline.png"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    print("wrote", build(out))
