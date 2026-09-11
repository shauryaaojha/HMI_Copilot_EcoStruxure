# -*- coding: utf-8 -*-
"""Builds the HMI Copilot deck. Design system first, content second."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import os

W, H = Inches(13.333), Inches(7.5)
GREEN  = RGBColor(0x3D, 0xCD, 0x58)
DARK   = RGBColor(0x0F, 0x14, 0x19)
DARK2  = RGBColor(0x1A, 0x22, 0x2B)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
INK    = RGBColor(0x1A, 0x1F, 0x26)
MUTED  = RGBColor(0x5A, 0x66, 0x73)
FAINT  = RGBColor(0x8A, 0x95, 0xA1)
LINE   = RGBColor(0xD8, 0xDE, 0xE5)
BG     = RGBColor(0xF4, 0xF6, 0xF8)
AMBER  = RGBColor(0xE8, 0x9C, 0x1F)
RED    = RGBColor(0xD9, 0x3B, 0x3B)
FONT   = "Arial"

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]
NOTES = []

def slide(bg=WHITE):
    s = prs.slides.add_slide(BLANK)
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    r.fill.solid(); r.fill.fore_color.rgb = bg; r.line.fill.background()
    r.shadow.inherit = False
    return s

def tb(s, x, y, w, h, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    t = s.shapes.add_textbox(x, y, w, h); tf = t.text_frame
    tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.paragraphs[0].alignment = align
    return tf

def para(tf, text, size=14, color=INK, bold=False, space_before=0, space_after=6,
         align=PP_ALIGN.LEFT, first=False, mono=False, line=1.25):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_before = Pt(space_before); p.space_after = Pt(space_after)
    p.line_spacing = line
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = color
    r.font.name = "Consolas" if mono else FONT
    return p

def rule(s, x, y, w, color=GREEN, h=Inches(0.045)):
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    r.fill.solid(); r.fill.fore_color.rgb = color; r.line.fill.background()
    r.shadow.inherit = False; return r

def box(s, x, y, w, h, fill=BG, line=None, rounded=False):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    if line: shp.line.color.rgb = line; shp.line.width = Pt(1)
    else: shp.line.fill.background()
    shp.shadow.inherit = False
    if rounded:
        try: shp.adjustments[0] = 0.06
        except Exception: pass
    return shp

def header(s, kicker, title, dark=False):
    c1 = FAINT if dark else MUTED
    c2 = WHITE if dark else INK
    if kicker:
        t = tb(s, Inches(0.75), Inches(0.45), Inches(11.8), Inches(0.3))
        para(t, kicker.upper(), 11, GREEN, True, first=True)
    # 11.8in of width fits about 849/(0.52*size) characters. Shrink rather than
    # wrap, because a second line lands on top of the rule below.
    n = len(title)
    size = 30 if n <= 50 else 26 if n <= 58 else 23 if n <= 66 else 21
    t = tb(s, Inches(0.75), Inches(0.78), Inches(11.8), Inches(0.75))
    para(t, title, size, c2, True, first=True, line=1.05)
    rule(s, Inches(0.75), Inches(1.62), Inches(0.9))

def note(s, text):
    s.notes_slide.notes_text_frame.text = text

def bullets(s, items, x=Inches(0.75), y=Inches(2.0), w=Inches(11.8), size=15, gap=10):
    tf = tb(s, x, y, w, H - y - Inches(0.6))
    for i, it in enumerate(items):
        if isinstance(it, tuple):
            head, body = it
            para(tf, head, size + 1, INK, True, space_before=0 if i == 0 else gap, space_after=3, first=(i == 0))
            para(tf, body, size - 1.5, MUTED, space_after=0)
        else:
            para(tf, "•   " + it, size, INK, space_before=0 if i == 0 else gap, space_after=0, first=(i == 0))
    return tf

LAST = {"bottom": Inches(2)}
WARN = []

def _rowh(texts, widths_in, size, minh):
    """PowerPoint grows a row to fit wrapped text, so estimate the wrap."""
    lines = 1
    for txt, win in zip(texts, widths_in):
        t = str(txt).lstrip("*~^!").rstrip("*")
        for seg in t.split("\n"):
            cpl = max(6, int((win - 0.2) * 72 / (size * 0.52)))
            lines = max(lines, -(-len(seg) // cpl))
    return max(minh, Inches(lines * size * 1.22 / 72 + 0.16))

def table(s, headers, rows, x=Inches(0.75), y=Inches(2.05), w=Inches(11.8),
          widths=None, size=12, rowh=Inches(0.42), headfill=DARK):
    n = len(rows) + 1
    if widths:
        tot = sum(widths); cols = [w * cw / tot for cw in widths]
    else:
        cols = [w / len(headers)] * len(headers)
    cols_in = [c / 914400 for c in cols]
    heights = [_rowh(headers, cols_in, size, Inches(0.4))]
    for row in rows:
        heights.append(_rowh(row, cols_in, size, rowh))
    total = sum(heights)
    shp = s.shapes.add_table(n, len(headers), x, y, w, total)
    t = shp.table
    for i, c in enumerate(cols): t.columns[i].width = Emu(int(c))
    for i, hgt in enumerate(heights): t.rows[i].height = Emu(int(hgt))
    for j, htxt in enumerate(headers):
        c = t.cell(0, j); c.fill.solid(); c.fill.fore_color.rgb = headfill
        c.margin_left = c.margin_right = Inches(0.1)
        c.margin_top = c.margin_bottom = Inches(0.05)
        c.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf = c.text_frame; tf.word_wrap = True; tf.paragraphs[0].text = ""
        r = tf.paragraphs[0].add_run(); r.text = htxt
        r.font.size = Pt(size); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = FONT
    for i, row in enumerate(rows, start=1):
        for j, val in enumerate(row):
            c = t.cell(i, j); c.fill.solid()
            c.fill.fore_color.rgb = WHITE if i % 2 else BG
            c.margin_left = c.margin_right = Inches(0.1)
            c.margin_top = c.margin_bottom = Inches(0.04)
            c.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = c.text_frame; tf.word_wrap = True; tf.paragraphs[0].text = ""
            txt = str(val); bold = False; col = INK
            if txt.startswith("**") and txt.endswith("**"): txt = txt[2:-2]; bold = True
            if txt.startswith("!!"): txt = txt[2:]; col = GREEN; bold = True
            if txt.startswith("~~"): txt = txt[2:]; col = MUTED
            if txt.startswith("^^"): txt = txt[2:]; col = AMBER; bold = True
            r = tf.paragraphs[0].add_run(); r.text = txt
            r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = col; r.font.name = FONT
    LAST["bottom"] = y + total
    if LAST["bottom"] > H - Inches(0.35):
        WARN.append(f"table overruns slide {len(prs.slides._sldIdLst)}: bottom={LAST['bottom']/914400:.2f}in")
    return LAST["bottom"]

def fy(off=0.2):
    """Y just under the last table drawn."""
    return LAST["bottom"] + Inches(off)

def code(s, lines, x=Inches(0.75), y=Inches(2.1), w=Inches(11.8), h=None, size=11.5, fill=DARK):
    h = h or Inches(0.28) * len(lines) + Inches(0.4)
    LAST["bottom"] = y + h
    box(s, x, y, w, h, fill=fill)
    tf = tb(s, x + Inches(0.28), y + Inches(0.2), w - Inches(0.5), h - Inches(0.3))
    for i, ln in enumerate(lines):
        col = GREEN if ln.startswith("#") else (WHITE if not ln.startswith("//") else FAINT)
        para(tf, ln if ln else " ", size, col, space_after=2, first=(i == 0), mono=True, line=1.15)
    return tf

def stats(s, items, y=Inches(2.4), h=Inches(1.55)):
    n = len(items); gap = Inches(0.22)
    total = Inches(11.8); cw = (total - gap * (n - 1)) / n
    for i, (big, lab) in enumerate(items):
        x = Inches(0.75) + (cw + gap) * i
        box(s, x, y, cw, h, fill=BG, line=LINE)
        tf = tb(s, x, y + Inches(0.22), cw, Inches(0.7), align=PP_ALIGN.CENTER)
        para(tf, big, 34, GREEN, True, first=True, align=PP_ALIGN.CENTER)
        tf2 = tb(s, x + Inches(0.12), y + Inches(0.95), cw - Inches(0.24), Inches(0.5), align=PP_ALIGN.CENTER)
        para(tf2, lab, 11.5, MUTED, first=True, align=PP_ALIGN.CENTER, line=1.15)

def picture(s, path, y=Inches(1.95), maxh=Inches(4.9), caption=None):
    from PIL import Image
    if not os.path.exists(path):
        print("MISSING", path); return
    iw, ih = Image.open(path).size
    availw = Inches(11.8)
    hh = maxh; ww = Emu(int(hh * iw / ih))
    if ww > availw: ww = availw; hh = Emu(int(ww * ih / iw))
    x = Emu(int((W - ww) / 2))
    pic = s.shapes.add_picture(path, x, y, ww, hh)
    ln = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, ww, hh)
    ln.fill.background(); ln.line.color.rgb = LINE; ln.line.width = Pt(1); ln.shadow.inherit = False
    if caption:
        tf = tb(s, Inches(0.75), y + hh + Inches(0.16), Inches(11.8), Inches(0.5), align=PP_ALIGN.CENTER)
        para(tf, caption, 11.5, MUTED, first=True, align=PP_ALIGN.CENTER, line=1.2)
    return pic

def section(num, title, sub):
    s = slide(DARK)
    box(s, 0, Inches(3.15), W, Inches(0.05), fill=GREEN)
    tf = tb(s, Inches(1.1), Inches(2.25), Inches(11), Inches(0.5))
    para(tf, num, 13, GREEN, True, first=True)
    tf = tb(s, Inches(1.1), Inches(2.6), Inches(11), Inches(0.9))
    para(tf, title, 40, WHITE, True, first=True)
    tf = tb(s, Inches(1.1), Inches(3.45), Inches(10), Inches(1.2))
    para(tf, sub, 16, FAINT, first=True, line=1.35)
    return s


D = "deck"

def tour(kicker, title, img, caption, points):
    from PIL import Image
    s = slide()
    header(s, kicker, title)
    ip = f"{D}/{img}.png"
    iw, ih = Image.open(ip).size
    hh = Inches(5.15); ww = Emu(int(hh * iw / ih))
    x = W - Inches(0.75) - ww
    s.shapes.add_picture(ip, x, Inches(1.95), ww, hh)
    ln = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, Inches(1.95), ww, hh)
    ln.fill.background(); ln.line.color.rgb = LINE; ln.line.width = Pt(1); ln.shadow.inherit = False
    colw = x - Inches(0.75) - Inches(0.4)
    tf = tb(s, Inches(0.75), Inches(2.0), colw, Inches(5.0))
    para(tf, caption, 15, INK, True, first=True, line=1.32, space_after=13)
    para(tf, points, 13, MUTED, line=1.38)
    return s

# ---------------------------------------------------------------- 1 title
s = slide(DARK)
box(s, 0, 0, Inches(0.16), H, fill=GREEN)
tf = tb(s, Inches(1.1), Inches(1.5), Inches(11), Inches(0.4))
para(tf, "SCHNEIDER ELECTRIC  ·  HMI HACKATHON  ·  PROBLEM STATEMENT 3", 12, GREEN, True, first=True)
tf = tb(s, Inches(1.1), Inches(2.1), Inches(11.2), Inches(1.9))
para(tf, "HMI Copilot", 62, WHITE, True, first=True, line=1.0)
para(tf, "From a PLC tag list and one sentence of English to a finished EcoStruxure project.", 22, RGBColor(0xC5,0xCE,0xD8), space_before=14, line=1.3)
rule(s, Inches(1.1), Inches(4.85), Inches(1.4))
tf = tb(s, Inches(1.1), Inches(5.2), Inches(11), Inches(1.4))
para(tf, "Target platform  ·  EcoStruxure Operator Terminal Expert 4.4", 14, FAINT, first=True, space_after=7)
para(tf, "A generated project opens in the product. It was never saved by the product.", 15, GREEN, True)
note(s, "One line: a tag export plus a sentence becomes a real .eote that opens in OTE 4.4.")

# ---------------------------------------------------------------- 2 problem
s = slide()
header(s, "The brief", "Four costs, and they compound")
table(s, ["Pain point", "What it actually looks like", "Where it hurts"],
 [["**Manual screen development**", "An engineer hand-places every lamp, bargraph and trend, then repeats it for 40 near-identical equipment screens.", "Hours per screen, times the plant"],
  ["**Expert-driven configuration**", "Only senior engineers know which object, animation and colour standard applies. Juniors block waiting on them.", "Seniors become a bottleneck"],
  ["**Complex tag integration**", "Hundreds of PLC symbols mapped by hand onto object properties. One wrong binding stays invisible until commissioning.", "Silent until it is expensive"],
  ["**Inconsistency**", "Two engineers on one project produce two differently-named, differently-coloured HMIs.", "Operators pay for it daily"]],
 widths=[2.6, 6.4, 3.0], size=12.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(0.9))
para(tf, "The binding problem is the sharp one. A wrong binding is not a drawing error — it is pump 2’s flow displayed under pump 1’s label, discovered during an upset.", 14.5, INK, True, first=True, line=1.3)
note(s, "Land on the binding example: this is a safety story, not only a productivity story.")

# ---------------------------------------------------------------- 3 decisive question
s = slide()
header(s, "The insight", "The question we asked before building anything")
box(s, Inches(0.75), Inches(2.05), Inches(11.8), Inches(1.15), fill=DARK)
tf = tb(s, Inches(1.15), Inches(2.32), Inches(11.0), Inches(0.7))
para(tf, "Does the output actually load into the engineering tool?", 25, WHITE, True, first=True)
tf = tb(s, Inches(0.75), Inches(3.5), Inches(11.8), Inches(3.0))
para(tf, "Everything else is decoration. A beautiful generated screen that EcoStruxure refuses to open is a mockup, and a judge who opens the file finds out in ten seconds.", 15.5, INK, first=True, line=1.4, space_after=16)
para(tf, "So the first thing we did was take apart the files the product itself ships — Blank.eote, two demo projects and three samples — and find out whether a project could be written from scratch at all.", 15.5, MUTED, line=1.4, space_after=16)
para(tf, "It could. That answer is the foundation of everything that follows.", 17, GREEN, True, line=1.4)

# ---------------------------------------------------------------- 4 format legible
s = slide()
header(s, "The insight", "The project format is fully legible")
code(s, [
 "<project>.eote                  ZIP   (nested entries use BACKSLASH separators)",
 " |-- Project.dat, Target.dat    JSON   project identity, panel model, resolution",
 " |-- Variables.db               SQLite the tags",
 " |-- Alarm.db                   SQLite alarm groups and alarms",
 " |-- Bindings.dat               JSON   Sources[] -> Bindings[] -> Targets[] graph",
 " +-- Screens\\<guid>\\Screen.dat  JSON   the object tree",
], y=Inches(1.95), size=12.5)
tf = tb(s, Inches(0.75), Inches(4.05), Inches(11.8), Inches(2.6))
para(tf, "No proprietary binary. No signature. No encryption. Every project carries _metadata with \"EncryptionInfo\": null and \"SignatureInfo\": null.", 15, INK, True, first=True, line=1.35, space_after=14)
para(tf, "Four properties make automation possible: everything meaningful is plain JSON or SQLite; nothing is signed or encrypted; bindings are declarative; and the geometry — absolute Location, Width and Height inside a ViewBox — maps one-to-one onto SVG.", 14.5, MUTED, line=1.35, space_after=14)
para(tf, "That last one carries the whole user experience. It is what lets one model drive both the preview and the file.", 15, GREEN, True, line=1.35)

# ---------------------------------------------------------------- 5 proof
s = slide()
header(s, "The insight", "Built, not proposed")
tf = tb(s, Inches(0.75), Inches(1.95), Inches(11.8), Inches(0.7))
para(tf, "Two .eote files were written from scratch and open in EcoStruxure Operator Terminal Expert 4.4. Neither was ever saved by the product.", 16, INK, first=True, line=1.35)
stats(s, [("19","parts placed\non the screen"),("7","typed tags in\nVariables.db"),("5","alarms in\nAlarm.db"),("11","bindings\nwired"),("0","objects placed\nby hand")], y=Inches(2.85))
table(s, ["File", "Written by", "Status"],
 [["HMICopilot_PumpStation.eote", "tools/make_project.py — the Python reference", "!!opens in OTE 4.4"],
  ["HMICopilot_TS.eote", "web/src/lib/ote/packager.ts — the browser path", "!!opens in OTE 4.4"]],
 y=Inches(4.75), widths=[3.4, 5.4, 3.0], size=12.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(0.8))
para(tf, "Two independent implementations — Python and TypeScript — agreeing on the same output is a far stronger claim than either passing its own tests.", 14, MUTED, first=True, line=1.3)
note(s, "File > Open Project. This is what separates us from a mockup.")

# ---------------------------------------------------------------- 6 novelty 1
s = slide()
header(s, "Novelty 01", "One model, two renderers — the preview cannot lie")
tf = tb(s, Inches(0.75), Inches(1.95), Inches(11.8), Inches(0.9))
para(tf, "The same JSON that becomes the project file drives the live preview. There is no second model of the screen, no “preview approximation” that drifts from the export.", 16, INK, first=True, line=1.35)
code(s, [
 "                       Screen.dat  (one JSON object tree)",
 "                              |",
 "               +--------------+--------------+",
 "               v                             v",
 "        SVG in the browser            .eote packager",
 "        (what the engineer            (what EcoStruxure",
 "         approves)                     opens)",
], y=Inches(3.0), size=13)
tf = tb(s, Inches(0.75), Inches(5.35), Inches(11.8), Inches(1.5))
para(tf, "What the engineer approves is what OTE opens.", 19, GREEN, True, first=True, space_after=10)
para(tf, "Most tools in this space render a pretty approximation and generate the real artifact separately. The two drift, and the customer finds the drift. Here they are the same object, so drift is not unlikely — it is impossible.", 14.5, MUTED, line=1.35)

# ---------------------------------------------------------------- 7 novelty 2
s = slide()
header(s, "Novelty 02", "The one rule, enforced by the compiler")
box(s, Inches(0.75), Inches(1.95), Inches(11.8), Inches(0.95), fill=DARK)
tf = tb(s, Inches(1.15), Inches(2.18), Inches(11.0), Inches(0.6))
para(tf, "The canvas may only render what the packager can emit.", 22, WHITE, True, first=True)
tf = tb(s, Inches(0.75), Inches(3.15), Inches(11.8), Inches(3.4))
para(tf, "A rule written in a document is a rule someone breaks at 2am. So this one is a type error instead.", 15.5, INK, first=True, line=1.35, space_after=14)
para(tf, "ScreenRenderer switches exhaustively over the part union in schema.ts, with a never assignment on the default branch. Add a part to the schema and the canvas stops compiling until it can draw it.", 15, MUTED, line=1.35, space_after=14)
para(tf, "The other half is a test: canvas.test.ts restates the Python reference renderer’s rules independently, so the two renderers cannot drift together and still pass.", 15, MUTED, line=1.35, space_after=16)
para(tf, "The visible corollary: the theme toggle themes the application and never the HMI screen, whose colours are palette indices from the project’s own colour set.", 14.5, GREEN, line=1.35)

# ---------------------------------------------------------------- 8 novelty 3
s = slide()
header(s, "Novelty 03", "Grounded twice, so invented properties are impossible")
table(s, ["Grounding", "Source", "What it prevents"],
 [["**Machine-readable schemas**", "Buildtime/PropertyDefinitions/ — the product’s own definitions of Screen, Variable, 25 parts and 13 layout objects", "A model inventing a property that does not exist. Structurally impossible, not merely unlikely."],
  ["**Real part shapes**", "50 part types extracted from the shipped sample projects into reference/part_examples.json", "A model guessing at the shape of a Lamp. Every shape we emit was observed in a project the product wrote."],
  ["**zod at the boundary**", "web/src/lib/ote/schema.ts — a discriminated union parsed at runtime", "A malformed object reaching the canvas or the packager at all."]],
 widths=[3.0, 5.5, 4.5], size=12.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(1.4))
para(tf, "The model is never asked “what should a pump screen look like?” in the abstract. It chooses among real parts, with real properties, from the product’s own vocabulary — which is why the output is boring in exactly the way engineering output should be boring.", 14.5, MUTED, first=True, line=1.35)

# ---------------------------------------------------------------- 9 boundary
s = slide()
header(s, "Novelty 04", "We meet the product at the artifact boundary")
code(s, [
 "   HMI Copilot                   BOUNDARY                 EcoStruxure OTE",
 "   (Next.js / TypeScript)  (files - language-agnostic)   (C# / C++ / Qt / Lua)",
 "        |                            |                            |",
 "   generated JSON  -->  project.eote -+--> File > Open Project --> a built HMI",
], y=Inches(1.95), size=12.5)
tf = tb(s, Inches(0.75), Inches(3.5), Inches(11.8), Inches(3.2))
para(tf, "EcoStruxure Buildtime is a .NET/C# shell with native Qt5/C++ modules. RunTime is C++/Qt5 with embedded Lua. We do not merge into any of it.", 15.5, INK, first=True, line=1.35, space_after=14)
para(tf, "That is judgement, not a workaround. Touching the internals would need an SDK we do not have and code signing, would break on every release, and would amount to asking Schneider to maintain a fork of its own product.", 15, MUTED, line=1.35, space_after=14)
para(tf, "Staying at the file boundary means the tool works with any OTE 4.4+ installation, survives upgrades, and could actually ship. And both layers already ship Qt5WebEngine, so this same interface can be docked inside the tool later with no new technology decision.", 15.5, GREEN, True, line=1.35)

# ---------------------------------------------------------------- 10 pipeline
s = slide()
header(s, "Architecture", "Eight steps from a tag export to a file OTE opens")
table(s, ["Step", "Stage", "In", "Out"],
 [["1", "**Tag Ingestion**", ".csv / .txt / .xlsx export", "Normalised {name, dataType, address, scanRate, comment}"],
  ["2", "**Equipment Inference**", "Tag names and comments", "Clusters: PMP_101_RUN + _FLT + _SPD = one pump"],
  ["3", "**Part Selector**", "Each tag and its role", "The right part from the 50 the product ships"],
  ["4", "**Layout Planner**", "Parts and panel size", "Positions inside a ViewBox, reading order respected"],
  ["5", "**Screen Generator**", "Layout + schema", "Screen.dat JSON constrained by the .propDef schema"],
  ["6", "**Binding Resolver**", "Tags and placed objects", "The Sources / Targets / Bindings graph"],
  ["7", "**Validation Engine**", "The whole project", "Findings, each clickable back to its object"],
  ["8", "**Project Packager**", "Everything above + skeleton", ".eote — screens, Variables.db, Alarm.db, Bindings.dat"]],
 widths=[0.5, 2.5, 3.4, 5.6], size=11.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(0.6))
para(tf, "Step 2 is where expert knowledge lives: a pump should have a fault alarm, so a missing one is flagged rather than silently skipped.", 13.5, MUTED, first=True, line=1.3)

# ---------------------------------------------------------------- 11 stack
s = slide()
header(s, "Architecture", "Stack, and why each piece")
table(s, ["Layer", "Choice", "Why"],
 [["Framework", "**Next.js (App Router), full stack**", "One repo, one language, one deploy. No CORS, no second dev server."],
  ["Canvas", "**Inline SVG, one node per object**", "Direct mapping to the OTE screen model. Click-to-select maps straight back to the JSON node."],
  ["State", "**Zustand + immer**", "A JSON tree with cheap undo/redo and snapshots."],
  ["Transport", "**SSE from a route handler**", "Streams one complete object at a time — never a partially-parsed JSON tree."],
  ["Model", "**Gemini, Claude as the alternative**", "Schema-grounded structured output. One model call per generation."],
  ["Packager", "**jszip + sql.js, Node runtime**", "No native module, so it runs anywhere including serverless."]],
 widths=[1.6, 3.6, 6.8], size=12)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(0.7))
para(tf, "Three packager constraints learned the hard way: the route must declare nodejs runtime not Edge; ZIP entry names must use backslash separators; only Variables.db and Alarm.db are written, the rest pass through verbatim.", 12.5, MUTED, first=True, line=1.3)

# ---------------------------------------------------------------- product tour (9)
section("01", "What we built", "The product, in seven screens.")

tour("Product tour", "The board — every screen in the project at once", "18-board-all-screens",
 "Eleven screens generated from one sentence, laid out as a board you can zoom and pan.",
 "A 1,248-tag plant is not one screen; it is a screen hierarchy. The board is where you see the hierarchy, and the strip above it is where you move between the screens in it.")

tour("Product tour", "The run overlay — the AI’s work in engineering language", "17-generation-running",
 "Eight steps, each reporting what it produced, each clickable to select the objects it created.",
 "Not “Thinking…”. Parse PLC tags → 1,248 tags. Infer equipment → pumps, instruments, motors. Configure alarms → 232. When the run finishes the overlay settles into a single line and gets out of the way.")

tour("Product tour", "The inspector — derived from the schema, not hand-written", "03-inspector-selected",
 "Select any object and edit its real properties. The fields are generated by walking the zod union at runtime.",
 "A field is a colour field because its shape is {Color:{Value}}, not because someone named it “Fill”. Add a property to the schema and the inspector grows it for free. Layers, Library and Tags sit beside it as tabs.")

tour("Product tour", "The binding map — the stated pain point, made visible", "04-bindings",
 "Tags on one side, object properties on the other, drawn from the real Sources / Targets graph the .eote contains.",
 "This is the highest-value view in the product, because tag integration is the pain point the brief names, and today it is invisible until commissioning.")

tour("Product tour", "Live simulation — behaviour before hardware", "06-simulation-live",
 "Flip to Live and a process model drives the canvas: lamps change state, numerics move, alarms raise and clear.",
 "Numerics are driven through their own alarm setpoints, so every alarm the project defines actually fires. Lead and standby pumps behave differently. This is the demo moment.")

tour("Product tour", "Tag import — corrections reported, never applied silently", "16-tags-imported-corrections",
 "1,248 tags parsed, five names corrected, every correction listed with its before and after.",
 "OTE silently drops names that break its rules on import. Here they are caught, auto-corrected, and the change is shown. This is the single most trust-relevant behaviour in the product.")

tour("Product tour", "Validation, then export — caught at the desk, signed off on paper", "12-export",
 "Seven rule families run before export: naming, binding integrity, type mismatches, completeness, alarms, unused tags, standards.",
 "Every finding carries the objectId of the thing that caused it, so the binding map and the validation list can never disagree. Export produces the .eote, a Variables.csv, and a standalone HTML sign-off report with no stylesheet, font host or script — because a commissioning laptop has no internet.")

# ---------------------------------------------------------------- headline result
s = slide(DARK)
tf = tb(s, Inches(0.75), Inches(0.5), Inches(11.8), Inches(0.4))
para(tf, "THE RESULT", 12, GREEN, True, first=True)
tf = tb(s, Inches(0.75), Inches(0.85), Inches(11.8), Inches(0.7))
para(tf, "One sentence. A whole plant.", 32, WHITE, True, first=True)
box(s, Inches(0.75), Inches(1.75), Inches(11.8), Inches(0.75), fill=DARK2)
tf = tb(s, Inches(1.05), Inches(1.93), Inches(11.2), Inches(0.5))
para(tf, "“Build the whole plant: an overview plus a screen for each area, with pump status, flows, levels and alarms”", 15, RGBColor(0xC5,0xCE,0xD8), first=True)
items = [("11","screens"),("560","objects"),("232","alarms\nconfigured"),("1,248","tags\ningested"),("0","errors\n0 warnings")]
n=len(items); gap=Inches(0.2); cw=(Inches(11.8)-gap*(n-1))/n
for i,(big,lab) in enumerate(items):
    x=Inches(0.75)+(cw+gap)*i
    box(s,x,Inches(2.85),cw,Inches(1.7),fill=DARK2)
    tf=tb(s,x,Inches(3.08),cw,Inches(0.7),align=PP_ALIGN.CENTER)
    para(tf,big,34,GREEN,True,first=True,align=PP_ALIGN.CENTER)
    tf=tb(s,x+Inches(0.1),Inches(3.82),cw-Inches(0.2),Inches(0.6),align=PP_ALIGN.CENTER)
    para(tf,lab,11.5,RGBColor(0x9A,0xA5,0xB1),first=True,align=PP_ALIGN.CENTER,line=1.2)
tf = tb(s, Inches(0.75), Inches(4.8), Inches(11.8), Inches(2.2))
para(tf, "From the 1,248-tag water treatment export, with a navigation model between the screens — a plant overview, then a screen per area, and the buttons that move between them.", 14.5, RGBColor(0xC5,0xCE,0xD8), first=True, line=1.35, space_after=10)
para(tf, "One measured run. Screens and objects vary with the model — other runs produced 8 / 434 and 10 / 486. What did not vary on any run: 232 alarms, 1,248 tags, 5 corrections, every binding resolved, 0 errors.", 13, RGBColor(0x9A,0xA5,0xB1), line=1.35, space_after=10)
para(tf, "Hand-placing several hundred objects and making every binding is the work this replaces. Apply your own hourly rate.", 16, GREEN, True, line=1.3)
note(s, "The money slide. Pause. Then let them do the arithmetic themselves.")

# ---------------------------------------------------------------- how built

s = slide()
header(s, "How we built it", "Two workstreams that could never touch the same file")
table(s, ["", "FORMAT", "SURFACE"],
 [["**Owns**", "Everything touching the .eote file format", "Everything the engineer sees"],
  ["**Files**", "lib/ote, lib/ai, lib/tags, validation, app/api, scripts, fixtures, tools", "components, app routes, store, lib/sim, styles"],
  ["**Delivered**", "The packager, tag ingestion, inference, the generation pipeline, validation rules, the sign-off report, the symbol index", "The design system, the canvas, the inspector, the binding map, simulation, the supporting screens, the demo path"],
  ["**Machine**", "Windows, with a licensed EcoStruxure 4.4 installation", "macOS"]],
 y=Inches(2.05), widths=[1.3, 5.2, 5.3], size=12)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(1.1))
para(tf, "Three files were frozen without a conversation: schema.ts, events.ts and package.json — the contracts between the two halves. The interesting constraint: FORMAT had the licensed install and SURFACE did not, so the format work had to be provable on a machine that could not run the product.", 13.5, MUTED, first=True, line=1.3)

s = slide()
header(s, "How we built it", "Testing, and the engineering by the numbers")
stats(s, [("467","tests in the suite"),("454","run anywhere"),("13","need a licensed\nEcoStruxure install"),("0","failing")], y=Inches(2.0))
stats(s, [("60","commits"),("18,251","lines of TypeScript"),("474","shipped symbols indexed"),("50","real part types extracted")], y=Inches(3.85))
bullets(s, [
 ("Two implementations, structurally diffed", "packager.test.ts diffs the TypeScript packager against the Python reference — same entries, same binding graph, same rows. Two independent implementations agreeing is stronger than either passing its own tests."),
 ("The renderer checked against a restatement, not an import", "canvas.test.ts restates the Python renderer’s rules independently, so the two cannot drift together and still pass."),
], y=Inches(5.7), size=13.5, gap=9)

# ---------------------------------------------------------------- what went wrong

s = slide()
header(s, "What went wrong", "The issue log")
table(s, ["What broke", "Why", "How it was fixed"],
 [["**The ZIP would not open in OTE**", "Nested entry names use backslash separators, which every ZIP library normalises to forward slashes.", "Write the entry names the product itself writes, and guard the separator with a test."],
  ["**Symbols lost their geometry**", "The graphics indexer dropped Commands and Points, keeping only derived path data — so a symbol could not round-trip.", "Keep all three, and assert with a test that they can never drift."],
  ["**Every large generation died**", "A React update loop: effect dependencies that changed identity on every store write. 232 alarm events blew past the nested-update limit.", "Dependencies narrowed to one, and a referentially idempotent idle state."],
  ["**Half the toolbar was unreachable**", "719px of a 1,498px toolbar sat past the right edge on a 1440px laptop, including Simulate.", "The run-state group pinned outside the scroll region."],
  ["**The Copilot column went invisible**", "Three new ground tokens were added to the dark theme and never given light-theme values, so dark grounds met dark ink.", "Contrast ratio 1.03, measured in the browser. Light values added."]],
 widths=[3.2, 5.0, 4.6], size=11.5)
note(s, "These are all real. The fact we can name them is the point.")

s = slide()
header(s, "What went wrong", "Two lessons that changed how we work")
box(s, Inches(0.75), Inches(1.95), Inches(11.8), Inches(0.8), fill=RGBColor(0xFD,0xF0,0xF0), line=RGBColor(0xF0,0xC0,0xC0))
tf = tb(s, Inches(1.1), Inches(2.13), Inches(11.1), Inches(0.5))
para(tf, "Parsed 1248 tags · Placed 29 objects · Generation failed: Maximum update depth exceeded", 14, RED, True, first=True, mono=True)
tf = tb(s, Inches(0.75), Inches(3.0), Inches(11.8), Inches(4.0))
para(tf, "1 · A demo fixture small enough to be convenient is small enough to hide the bug that matters.", 16, INK, True, first=True, line=1.3, space_after=9)
para(tf, "The seven-tag fixture never triggered it. A 1,248-tag export did, every time. Every sample we ship now exercises a different path through the importer rather than flattering it.", 14.5, MUTED, line=1.35, space_after=18)
para(tf, "2 · A passing test suite does not tell you whether a button is reachable.", 16, INK, True, line=1.3, space_after=9)
para(tf, "The crash was found by a person clicking. So we started driving the real product in a real browser at 1280, 1440 and 1920 — measuring overflow, clipped text, hit-target size and colour contrast. That found the off-screen Simulate button, a timeline that said “0 of 8” while showing seven, two hydration mismatches, and the invisible Copilot column.", 14.5, MUTED, line=1.35, space_after=14)
para(tf, "Zero console errors across all eleven routes, at every width, in both themes.", 15, GREEN, True, line=1.3)

# ---------------------------------------------------------------- production

s = slide()
header(s, "Production reality", "The decision that comes before the architecture")
tf = tb(s, Inches(0.75), Inches(1.9), Inches(11.8), Inches(1.0))
para(tf, "Every .eote we write contains Schneider’s own database files, copied through verbatim — Recipe.db, Security.db, Language.db, DriverConfig.db. Each developer extracts their own copy from their own licensed installation.", 14.5, INK, first=True, line=1.35)
para(tf, "Right for a hackathon. Not a posture a product can ship in: a hosted service needs the skeleton on the server, and a server holding those files is redistributing them.", 14.5, RED, True, line=1.35, space_before=8)
table(s, ["", "How it works", "Verdict"],
 [["**A. Local generation**", "Runs on a machine that already has a licensed OTE install. The skeleton never moves.", "!!Build this"],
  ["**B. Server plans, browser packages**", "Layout server-side; the .eote assembled in the browser from a skeleton on the engineer’s own disk.", "~~Don’t — Chromium-only, fragile"],
  ["**C. Schneider blesses it**", "An OEM agreement covering a redistributable skeleton, or better, an official project API.", "!!Pitch this"]],
 y=Inches(3.6), widths=[2.9, 6.6, 2.3], size=12)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(1.0))
para(tf, "Build for A, pitch for C — they are compatible. A is also the honest fit: plant engineering happens on restricted, frequently air-gapped networks, and a cloud tool that phones a model API is a procurement fight at every site.", 14, GREEN, True, first=True, line=1.3)
note(s, "This is the slide that shows we understand the business, not just the code.")

s = slide()
header(s, "Production reality", "Four gaps, named plainly — and the safety position")
table(s, ["#", "Gap", "What we do about it"],
 [["1", "It can only write, never read. Most HMI work is brownfield — adding a pump to a station built in 2019, not starting from nothing.", "Build the reader as a preservation problem first: model what you understand, carry the rest through untouched, assert a byte-identical round trip."],
  ["2", "Persistence is local only. Autosave to localStorage survives a reload; it does not survive a new machine.", "For architecture A this is a local database and a file on disk — not a multi-tenant backend."],
  ["3", "Nothing talks to a PLC. Generated variables are internal, so the export is a drawing, not a project.", "Device driver configuration, written into DriverConfig.db rather than passed through."],
  ["4", "Generation quality is unmeasured. No corpus, no scoring, no regression gate.", "A golden corpus of 20–50 real tag exports with the screens an experienced engineer would draw. Ship nothing that regresses binding accuracy."]],
 widths=[0.4, 5.8, 5.8], size=11.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(1.0))
para(tf, "And the safety position: never auto-deploy. The engineer watches every object appear and approves before export. That is not a hackathon limitation to grow out of — it is the product’s licence to exist.", 14, INK, True, first=True, line=1.3)

s = slide()
header(s, "Production reality", "How it merges with the product — the integration ladder")
table(s, ["Tier", "Mechanism", "Status"],
 [["**0 — Artifact**", "Generate the .eote; the engineer opens it. Zero coupling, no licence dependency.", "!!Working today"],
  ["**1 — Lua scripting**", "Both layers embed Lua — the product’s own sanctioned extension point.", "Natural next step"],
  ["**2 — Managed plugin**", "Buildtime is .NET, so the generator can be repackaged as an in-process C# library.", "^^Needs Schneider’s SDK"],
  ["**3 — UI automation**", "Driving the OTE window programmatically.", "~~Brittle. Not worth it"]],
 widths=[1.9, 7.4, 2.5], size=12.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(1.6))
para(tf, "And it can live inside OTE later, with no new technology decision.", 17, GREEN, True, first=True, line=1.3, space_after=10)
para(tf, "Both Buildtime and RunTime already ship Qt5WebEngine — an embedded Chromium — and the parts library already includes a WebBrowser object. The same interface can be docked inside the engineering tool, and surfaced on the panel at runtime for operator diagnostics, on a runtime Schneider already distributes.", 14.5, MUTED, line=1.35)

# ---------------------------------------------------------------- business
section("02", "The business model", "Who pays, why, how much, and what stops someone else doing it.")

s = slide()
header(s, "Business model", "Three buyers, one wedge")
table(s, ["Buyer", "What they feel", "Why they buy", "Priority"],
 [["**System integrators &\npanel builders**", "Fixed-price projects, margin pressure, HMI engineering is a large share of the hours.", "Time saved converts directly into margin on work they have already quoted. They buy tools with their own money and decide fast.", "!!THE WEDGE"],
  ["**End users — plants,\nutilities, OEMs**", "Inconsistency across contractors, standards drift, errors found at commissioning.", "They own the house style. Standards packs make every contractor produce their HMI, not the contractor’s.", "Expand"],
  ["**Schneider Electric**", "OTE competes with Siemens WinCC and Rockwell FactoryTalk on engineering productivity.", "A generative front end that runs on the format they already ship, with no change to the product.", "Scale"]],
 widths=[2.5, 4.0, 5.0, 1.5], size=11.5)
tf = tb(s, Inches(0.75), fy(), Inches(11.8), Inches(0.9))
para(tf, "Start with integrators: sharpest pain, shortest sales cycle, and they already have a licensed OTE installation on every engineering laptop — exactly what architecture A requires.", 14, INK, True, first=True, line=1.3)

s = slide()
header(s, "Business model", "Price, and why a seat pays for itself")
table(s, ["Tier", "Who", "Includes", "Price"],
 [["**Individual**", "One engineer, one laptop", "Local generation, all part types, symbol library, validation, export, sign-off report", "€149 / engineer / month"],
  ["**Team**", "5–25 seats at an integrator", "Plus shared standards packs, project templates, priority support", "€119 / seat / month"],
  ["**Site / Enterprise**", "A plant or large integrator", "On-prem or air-gapped install, bring-your-own or local model, audit trail, custom standards packs, conformance, SLA", "from €40k / year"],
  ["**OEM**", "Schneider Electric", "Bundled with or sold alongside OTE; revenue share or per-licence royalty", "Negotiated"]],
 widths=[1.8, 2.4, 5.6, 2.6], size=11.5)
code(s, [
 "#  BREAK-EVEN   (assumptions stated, customer changes them)",
 "   Fully-loaded automation engineer   EUR 70-100 / hour",
 "   Team seat                          EUR 1,428 / year",
 "   Hours it must give back            1,428 / 85  =  ~17 hours  =  two working days",
], y=fy(0.25), size=12.5)
tf = tb(s, Inches(0.75), fy(0.18), Inches(11.8), Inches(0.8))
para(tf, "Break-even at two days a year is an easy question to answer honestly — and it does not depend on a savings percentage we have not measured. Illustrative pricing.", 13.5, GREEN, True, first=True, line=1.28)

s = slide()
header(s, "Business model", "Go to market, and what stops someone copying it")
table(s, ["", "Land", "Expand", "Scale"],
 [["**Who**", "System integrators, 5–50 engineers", "Their end customers — plants and utilities", "Schneider’s channel"],
  ["**Motion**", "Direct, self-serve trial on a laptop that already has OTE", "Standards packs authored to the customer’s house style", "OEM agreement, bundled with OTE"],
  ["**Proof needed**", "A generated project opens. Already true.", "Round-trip safety on brownfield, and the audit trail", "Version-matrix conformance across OTE releases"]],
 widths=[1.5, 3.5, 3.5, 3.5], size=11.5)
bullets(s, [
 ("Format knowledge that had to be earned", "Fifty real part types, the machine-readable property definitions, the palette out of the product’s own Colors.lua, the naming rules, and the backslash separator that decides whether a file opens. None of it documented publicly; all verified by a file that opens."),
 ("Two implementations that agree, and a compiler-enforced rule", "Anyone can write one packager; proving it correct is the work. A competitor who builds a preview separately from the generator ships drift their customers find."),
 ("Standards packs become switching cost", "Once a customer’s conventions live in the tool as data and every contractor generates against them, leaving means renegotiating consistency across a supply chain."),
], y=fy(0.28), size=12.5, gap=7)

s = slide()
header(s, "Business model", "Risks, and what we would build next")
table(s, ["Risk", "Severity", "Mitigation"],
 [["**Schneider declines a redistributable skeleton**", "^^High", "Architecture A needs no redistribution — the tool runs where a licence already is. The business survives a “no”."],
  ["**A generated binding is wrong and nobody catches it**", "^^Critical", "Never auto-deploy. The engineer approves before export, findings carry object ids, and the golden corpus gates every change to binding accuracy."],
  ["**Format drift across OTE versions**", "^^Medium", "Part schemas read from the installation at run time; the packager should refuse to write a version it has not been proven against."],
  ["**Air-gapped sites cannot reach a model**", "^^Medium", "A local model is a requirement, not a nice-to-have. The provider seam is one module today — cheap now, expensive once call sites spread."]],
 widths=[3.8, 1.3, 6.7], size=11.5)
tf = tb(s, Inches(0.75), fy(0.22), Inches(11.8), Inches(1.4))
para(tf, "Next, in order: take the licensing question to Schneider · start the .eote reader as a preservation problem · stand up the golden corpus. Then durable persistence and the audit trail. Then ISA-101 and ISA-18.2 rules and the version matrix. Then desktop packaging and a local model.", 14, INK, True, first=True, line=1.32, space_after=8)
para(tf, "Deliberately cut: multi-tenancy, SSO, a marketplace, real-time collaboration. Two engineers do not edit one HMI screen at once.", 13, MUTED, line=1.3)

# ---------------------------------------------------------------- close
s = slide()
header(s, "In summary", "Where this stands")
stats(s, [("11","screens from\none sentence"),("560","objects, none\nplaced by hand"),("1,248","tags\ningested"),("467","tests"),("4.4","opens in OTE")], y=Inches(2.1))
tf = tb(s, Inches(0.75), Inches(3.75), Inches(11.8), Inches(0.4))
para(tf, "Screens and objects are one measured run and vary with the model; alarms, tags, corrections and the zero-error result did not vary on any run.", 11.5, MUTED, first=True)
bullets(s, [
 ("The loop works, end to end", "Tag export in, conversation, live canvas, validation, and a .eote that opens in EcoStruxure Operator Terminal Expert 4.4 — a file the product never saved."),
 ("The format layer is genuinely defensible", "Two independent implementations, structurally diffed. The canvas cannot draw what the packager cannot emit, and the compiler enforces it."),
 ("What stands between this and a real engineer is not features", "It is the licensing question, a reader that never loses what it does not understand, and a way to prove the generation is right. Everything else is sequencing."),
], y=Inches(4.25), size=14, gap=11)

s = slide(DARK)
box(s, 0, 0, Inches(0.16), H, fill=GREEN)
tf = tb(s, Inches(1.1), Inches(2.3), Inches(11), Inches(2.2))
para(tf, "The AI does not replace\nthe HMI engineer.", 40, WHITE, True, first=True, line=1.15)
rule(s, Inches(1.1), Inches(4.15), Inches(1.4))
tf = tb(s, Inches(1.1), Inches(4.6), Inches(10.6), Inches(1.8))
para(tf, "It encodes the senior engineer’s judgement — which part to use, which alarm every pump needs, which naming standard applies — and makes it available to everyone on the team, every time.", 19, RGBColor(0xC5,0xCE,0xD8), first=True, line=1.4)
tf = tb(s, Inches(1.1), Inches(6.5), Inches(11), Inches(0.5))
para(tf, "HMI Copilot  ·  From Intent to HMI — Faster. Smarter. Safer.", 13, GREEN, True, first=True)

for w in WARN: print("WARN:", w)
prs.save("HMI_Copilot_Deck.pptx")
print("SLIDES:", len(prs.slides._sldIdLst))
