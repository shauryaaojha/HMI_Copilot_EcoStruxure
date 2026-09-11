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

def demo(kicker, title, img, caption, points, badge=None):
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
    y = Inches(2.0)
    if badge:
        box(s, Inches(0.75), y, colw, Inches(0.42), fill=GREEN)
        tfb = tb(s, Inches(0.85), y + Inches(0.09), colw - Inches(0.2), Inches(0.3))
        para(tfb, badge, 12, WHITE, True, first=True)
        y = y + Inches(0.62)
    tf = tb(s, Inches(0.75), y, colw, Inches(4.6))
    para(tf, caption, 15.5, INK, True, first=True, line=1.32, space_after=13)
    para(tf, points, 13, MUTED, line=1.38)
    return s

# ================================================== 1 · HOOK (0:00, 20s)
s = slide(DARK)
box(s, 0, 0, Inches(0.16), H, fill=GREEN)
tf = tb(s, Inches(1.1), Inches(0.95), Inches(11), Inches(0.4))
para(tf, "SCHNEIDER ELECTRIC  ·  HMI HACKATHON  ·  PROBLEM STATEMENT 3", 11.5, GREEN, True, first=True)
tf = tb(s, Inches(1.1), Inches(1.5), Inches(11.4), Inches(1.0))
para(tf, "HMI Copilot", 48, WHITE, True, first=True, line=1.0)
box(s, Inches(1.1), Inches(2.65), Inches(11.1), Inches(0.8), fill=DARK2)
tf = tb(s, Inches(1.4), Inches(2.85), Inches(10.5), Inches(0.5))
para(tf, "“Build the whole plant: an overview plus a screen for each area, with pump status, flows, levels and alarms”", 14.5, RGBColor(0xC5,0xCE,0xD8), first=True)
items = [("11","screens"),("560","objects"),("232","alarms"),("1,248","tags bound"),("0","by hand")]
n=len(items); gap=Inches(0.22); cw=(Inches(11.1)-gap*(n-1))/n
for i,(big,lab) in enumerate(items):
    x=Inches(1.1)+(cw+gap)*i
    box(s,x,Inches(3.75),cw,Inches(1.5),fill=DARK2)
    tf=tb(s,x,Inches(3.98),cw,Inches(0.7),align=PP_ALIGN.CENTER)
    para(tf,big,32,GREEN,True,first=True,align=PP_ALIGN.CENTER)
    tf=tb(s,x+Inches(0.08),Inches(4.68),cw-Inches(0.16),Inches(0.4),align=PP_ALIGN.CENTER)
    para(tf,lab,11.5,RGBColor(0x9A,0xA5,0xB1),first=True,align=PP_ALIGN.CENTER)
rule(s, Inches(1.1), Inches(5.62), Inches(1.4))
tf = tb(s, Inches(1.1), Inches(5.95), Inches(11.1), Inches(1.2))
para(tf, "And the file opens in EcoStruxure Operator Terminal Expert 4.4.", 22, WHITE, True, first=True, line=1.25, space_after=8)
para(tf, "It was never saved by the product.", 15, GREEN, True)
note(s, "0:00–0:20 · HOOK. Read the sentence, then the numbers, then the last line slowly. Two seconds of silence. Do not explain yet.")

# ================================================== 2 · PROBLEM (0:20, 30s)
s = slide()
header(s, "01 · The problem", "Today this is done by hand, every time")
table(s, ["The cost the brief names", "What it looks like on a real project"],
 [["**Manual screen development**", "Hand-place every lamp, bargraph and trend. Then repeat it for 40 near-identical equipment screens."],
  ["**Expert-driven configuration**", "Only senior engineers know which object, animation and colour standard applies. Juniors block on them."],
  ["**Complex tag integration**", "Hundreds of PLC symbols mapped by hand onto object properties, one property sheet at a time."],
  ["**Inconsistency**", "Two engineers on one project produce two differently-named, differently-coloured HMIs."]],
 widths=[3.3, 8.7], size=13.5)
box(s, Inches(0.75), fy(0.28), Inches(11.8), Inches(1.0), fill=DARK)
tf = tb(s, Inches(1.15), fy(0.28) + Inches(0.22), Inches(11.0), Inches(0.6))
para(tf, "A wrong binding is not a drawing error. It is pump 2’s flow under pump 1’s label, found during an upset.", 19, WHITE, True, first=True)
note(s, "0:20–0:50 · Do not read the table. Land the black bar: this is a safety problem, not only a productivity one.")

# ================================================== 3 · SOLUTION (0:50, 25s)
s = slide()
header(s, "02 · The solution", "A tag export and a sentence become a finished project")
code(s, [
 "   PLC tag export  (.csv / .xlsx / symbol file) ---+",
 "                                                   |",
 "   \"Two pump station with running lamps,        ---+---> HMI COPILOT ---> project.eote",
 "    a flow display and a high-level alarm\"         |          |           validation report",
 "                                                   |          |",
 "   Company standards (naming, colours, layout) ----+          v",
 "                                                     LIVE CANVAS + BINDING MAP",
 "                                                     (the engineer sees it and steers it)",
], y=Inches(1.95), size=12.5)
tf = tb(s, Inches(0.75), Inches(4.75), Inches(11.8), Inches(2.2))
para(tf, "One file. File ▸ Open Project, and the HMI is there — screens drawn, tags declared, alarms configured, bindings wired. Nothing to import, nothing to assemble.", 16, INK, True, first=True, line=1.32, space_after=14)
para(tf, "The engineer stays in control throughout: the AI proposes, the canvas makes the proposal legible, and a human accepts, edits or redirects. It never deploys anything itself.", 14.5, MUTED, line=1.35)
note(s, "0:50–1:15 · The product in one diagram. Stress the last line — the human is in the loop by design, not by limitation.")

# ================================================== 4 · FILE STRUCTURE (1:15, 25s)
s = slide()
header(s, "03 · The project file", "Why this is possible at all")
code(s, [
 "<project>.eote                  ZIP    (nested entries use BACKSLASH separators)",
 " |-- Project.dat, Target.dat    JSON   project identity, panel model, resolution",
 " |-- Variables.db               SQLite the tags",
 " |-- Alarm.db                   SQLite alarm groups and alarms",
 " |-- Recipe.db, Security.db ... SQLite other subsystems, passed through untouched",
 " |-- Bindings.dat               JSON   Sources[] -> Bindings[] -> Targets[] graph",
 " |-- Screens\\Hierarchy.dat      JSON   screen order",
 " +-- Screens\\<guid>\\Screen.dat  JSON   the object tree",
], y=Inches(1.9), size=12.5)
tf = tb(s, Inches(0.75), Inches(4.65), Inches(11.8), Inches(2.4))
para(tf, "Plain JSON and plain SQLite. No signature. No encryption. Nothing to defeat.", 17, INK, True, first=True, line=1.3, space_after=13)
para(tf, "Bindings are declarative — wiring a tag to a display is one JSON object. And the geometry is absolute Location, Width and Height inside a ViewBox, which maps one-to-one onto SVG. That last property is what lets one model drive both the preview and the file.", 14.5, MUTED, line=1.35, space_after=13)
para(tf, "So the first thing we did was not design a UI. It was to prove a project could be written from scratch.", 15.5, GREEN, True, line=1.3)
note(s, "1:15–1:40 · The enabling insight. Say: we asked the one question that kills this category of idea, and we asked it first.")

# ================================================== 5 · ARCHITECTURE (1:40, 35s)
s = slide()
header(s, "04 · System architecture", "Eight stages, one streaming contract")
code(s, [
 "+---------------------------------------------------------------------------+",
 "|  WEB CLIENT   Conversation . Live HMI canvas . Binding map . Validation    |",
 "+-------------------------------+-------------------------------------------+",
 "                                |   SSE - one finished object at a time",
 "+-------------------------------v-------------------------------------------+",
 "|  ORCHESTRATOR                                                             |",
 "|    Tag Ingestion --> Equipment Inference --> Layout Planner               |",
 "|          |                   |                     |                      |",
 "|          |                   v                     v                      |",
 "|          |            Part Selector -------> Screen Generator             |",
 "|          |        (50 real part shapes)    (schema-grounded JSON)         |",
 "|          +------------> Binding Resolver <--------+                       |",
 "|                               |                                           |",
 "|                    Validation Engine --> Project Packager                 |",
 "|                          (7 rules)     (.eote: screens, Variables.db,     |",
 "|                                         Alarm.db, Bindings.dat)           |",
 "+---------------------------------------------------------------------------+",
], y=Inches(1.88), size=10.5)
tf = tb(s, Inches(0.75), Inches(5.72), Inches(11.8), Inches(1.5))
para(tf, "One model, two renderers — so the preview cannot lie.", 18, GREEN, True, first=True, line=1.28, space_after=9)
para(tf, "The same Screen.dat JSON drives the SVG canvas and the packager. There is no second model of the screen to drift from the first, and the compiler enforces it: the canvas switches exhaustively over the part union, so it cannot draw a part the packager cannot write.", 14, MUTED, line=1.33)
note(s, "1:40–2:15 · The longest non-demo slide. Trace the flow left to right once, then land the green line — that is the credibility claim.")

# ================================================== 6-9 · DEMO (2:15, 100s)
demo("05 · Demo", "One sentence becomes a plant", "18-board-all-screens",
 "Eleven screens on a board. An overview, then a screen per area, with navigation between them.",
 "A 1,248-tag plant is not one screen — it is a hierarchy, and inferring that hierarchy from tag names is the actual problem. Every unit gets a screen.",
 badge="DEMO · 1  ·  THE RESULT")
note(prs.slides[-1], "2:15–2:40 · Switch to the live app here if it is up. Otherwise this slide is the fallback.")

demo("05 · Demo", "You watch it work, in engineering language", "17-generation-running",
 "Eight steps, each reporting what it produced, each clickable to select the objects it created.",
 "Not “Thinking…”. Parsed 1,248 tags. Inferred pumps, instruments, motors. Configured 232 alarms. An engineer will not accept a screen they did not see being built.",
 badge="DEMO · 2  ·  THE PIPELINE, RUNNING")
note(prs.slides[-1], "2:40–3:02 · Point at the step details. This is the difference between a black box and a tool.")

demo("05 · Demo", "Every tag, wired and visible", "04-bindings",
 "The binding map, drawn from the real Sources / Targets graph inside the .eote.",
 "Tag integration is the pain point the brief names, and today it is invisible until commissioning. Here you can check it before you export.",
 badge="DEMO · 3  ·  THE PAIN POINT, SOLVED")
note(prs.slides[-1], "3:02–3:24 · The highest-value view. Say: this is the stated problem, and this is it solved.")

demo("05 · Demo", "Behaviour, before any hardware exists", "06-simulation-live",
 "Press Simulate and a process model drives the screen: lamps change state, numbers move, alarms raise.",
 "Values are driven through the project’s own alarm setpoints, so every alarm it configured actually fires. Lead and standby pumps behave differently.",
 badge="DEMO · 4  ·  VALIDATION WITHOUT HARDWARE")
note(prs.slides[-1], "3:24–3:46 · Let it run in silence for a few seconds. The alarms firing is the moment.")

# ================================================== 10 · PROOF (3:46, 24s)
s = slide()
header(s, "06 · Proof", "Built, not proposed")
tf = tb(s, Inches(0.75), Inches(1.95), Inches(11.8), Inches(0.7))
para(tf, "Two .eote files written from scratch, both open in EcoStruxure Operator Terminal Expert 4.4. Neither was ever saved by the product.", 16.5, INK, first=True, line=1.35)
stats(s, [("19","parts placed"),("7","typed tags"),("5","alarms"),("11","bindings"),("0","placed by hand")], y=Inches(2.9))
stats(s, [("467","tests"),("474","shipped symbols indexed"),("50","real part types extracted"),("2","independent packagers\nthat agree")], y=Inches(4.75))
tf = tb(s, Inches(0.75), Inches(6.5), Inches(11.8), Inches(0.7))
para(tf, "A Python reference and a TypeScript packager, structurally diffed against each other. Two implementations agreeing is a stronger claim than either passing its own tests.", 13.5, MUTED, first=True, line=1.3)
note(s, "3:46–4:10 · If a judge takes one thing away, it is this slide. Offer to open the file on their machine.")

# ================================================== 11 · BUSINESS (4:10, 35s)
s = slide()
header(s, "07 · Business proposal", "Who pays, and what it costs them")
table(s, ["", "Who", "Why they buy", "Price"],
 [["**The wedge**", "System integrators and panel builders", "Fixed-price work. Time saved is margin on hours they already quoted, and they decide fast.", "**₹3,499 / seat / month**"],
  ["**Expand**", "Plants, utilities, OEMs", "They own the house style. Standards packs make every contractor produce their HMI.", "from ₹25,00,000 / year"],
  ["**Scale**", "Schneider Electric", "A generative front end for the format they already ship, with no change to the product.", "OEM"]],
 widths=[1.4, 3.0, 5.6, 2.4], size=12.5)
code(s, [
 "#  BREAK-EVEN      Indian automation engineer, fully loaded   INR 700-1,200 / hour",
 "                   Team seat                                  INR 41,988 / year",
 "                   Hours it must give back    41,988 / 950  =  ~44 h  =  5.5 days",
], y=fy(0.22), size=12.5)
tf = tb(s, Inches(0.75), fy(0.18), Inches(11.8), Inches(0.8))
para(tf, "Does generating your first draft and resolving your bindings save you five days a year? That is the whole question — and it needs no savings claim we have not measured.", 14, GREEN, True, first=True, line=1.28)
note(s, "4:10–4:45 · Integrators already have the licensed OTE install the tool needs. Customer and technical precondition are the same people.")

# ================================================== 12 · FINAL (4:45, 15s)
s = slide(DARK)
box(s, 0, 0, Inches(0.16), H, fill=GREEN)
tf = tb(s, Inches(1.1), Inches(1.35), Inches(11), Inches(1.6))
para(tf, "The AI does not replace\nthe HMI engineer.", 38, WHITE, True, first=True, line=1.12)
rule(s, Inches(1.1), Inches(3.15), Inches(1.4))
tf = tb(s, Inches(1.1), Inches(3.55), Inches(10.8), Inches(1.6))
para(tf, "It encodes the senior engineer’s judgement — which part to use, which alarm every pump needs, which naming standard applies — and gives it to everyone on the team, every time.", 18, RGBColor(0xC5,0xCE,0xD8), first=True, line=1.38)
tf = tb(s, Inches(1.1), Inches(5.2), Inches(11), Inches(1.0))
para(tf, "It works today, at the file boundary, with no change to Schneider’s product.", 16, WHITE, True, first=True, space_after=9)
para(tf, "Ask us to open the generated project on your machine.", 15, GREEN, True)

# The repo, given the room it deserves - judges do look.
box(s, Inches(1.1), Inches(6.15), Inches(8.6), Inches(0.62), fill=DARK2)
tfr = tb(s, Inches(1.35), Inches(6.25), Inches(8.2), Inches(0.45))
para(tfr, "github.com/shauryaaojha/HMI_Copilot_EcoStruxure", 15, GREEN, True, first=True, mono=True)
tf = tb(s, Inches(1.1), Inches(6.98), Inches(11), Inches(0.4))
para(tf, "HMI Copilot  ·  From Intent to HMI — Faster. Smarter. Safer.", 12, FAINT, True, first=True)
note(s, "4:45–5:00 · Close on the invitation. Stop talking.")

for w in WARN: print("WARN:", w)
prs.save("HMI_Copilot_5min.pptx")
print("SLIDES:", len(prs.slides._sldIdLst))
