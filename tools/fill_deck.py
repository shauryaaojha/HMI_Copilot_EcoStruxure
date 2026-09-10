"""Fill the hackathon submission slide in 'Encode PS 3.pptx'.

Slide 1 is the blank template; slide 2 is the worked example that ships with it.
Only slide 1 is written to.
"""

import copy
import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

DECK = "Encode PS 3.pptx"
DIAGRAM = "assets/pipeline.png"

FONT = "Abadi Extra Light"
INK = RGBColor(0x24, 0x2C, 0x36)
GREEN = RGBColor(0x0F, 0x7B, 0x3E)

TEAM_NAME = "<Team name>"
TEAM_MEMBERS = "<Member 1, Member 2, Member 3>"

TITLE = "HMI Copilot — AI-Powered HMI Project Generator"

PROBLEM = (
    "HMI development is manual and expert-dependent. Engineers design screens, map "
    "hundreds of PLC tags and configure alarms by hand — causing errors, inconsistent "
    "HMIs and delays in commissioning."
)

SOLUTION = [
    ("HMI Copilot converts a PLC tag list and natural-language requirements into a "
     "complete, validated EcoStruxure Operator Terminal Expert project.", True),
    ("Engineers provide a PLC tag export, plain-English requirements and their company "
     "HMI standards. The Copilot parses the tags, infers the equipment, selects the right "
     "components, lays out the screens, generates the alarms and bindings, validates "
     "everything, and exports a native .eote project.", False),
    ("Human-in-the-loop: engineers inspect, edit, redirect and approve every generated "
     "element before export.", False),
    ("Already working — a generated .eote opens directly in EcoStruxure Operator "
     "Terminal Expert, with its screen, tags, alarms and bindings already in place.", False),
]

WHY = [
    "Minutes instead of hours or days to produce a new equipment screen.",
    "Automatic tag-to-object binding removes the most repetitive, error-prone step in the job.",
    "Design-time validation catches naming, binding and type errors long before commissioning.",
    "The AI encodes engineering standards, so screens stay consistent across the whole team — "
    "and every decision it makes is explained and auditable.",
    "Most AI tools generate a design or some code. HMI Copilot generates the actual "
    "engineering artifact — and keeps the engineer in control.",
]

TECH = [
    "Next.js · React · TypeScript",
    "Inline SVG live preview",
    "Zustand + Immer",
    "Claude Opus 5, schema-",
    "   grounded generation",
    "Node runtime backend",
    "SheetJS · JSZip · SQL.js",
    "JSON + SQLite artifacts",
    "EcoStruxure OTE 4.4",
    "Modbus / OPC-UA (sim)",
]


def find(container, shape_id):
    for sh in container.shapes:
        if sh.shape_id == shape_id:
            return sh
        if sh.shape_type == 6:
            got = find(sh, shape_id)
            if got is not None:
                return got
    return None


def write(shape, blocks, size, bold_first=False, space_after=6, colour=INK):
    """Replace a text box's content with styled paragraphs."""
    tf = shape.text_frame
    tf.word_wrap = True
    for p in list(tf.paragraphs)[1:]:
        p._element.getparent().remove(p._element)
    first = tf.paragraphs[0]
    for r in list(first.runs):
        r._r.getparent().remove(r._r)

    for i, block in enumerate(blocks):
        text, bold = block if isinstance(block, tuple) else (block, bold_first and i == 0)
        para = first if i == 0 else tf.add_paragraph()
        para.space_after = Pt(space_after)
        run = para.add_run()
        run.text = text
        run.font.size = Pt(size)
        run.font.name = FONT
        run.font.bold = bold
        run.font.color.rgb = GREEN if bold else colour


def main():
    prs = Presentation(DECK)
    slide = prs.slides[1]

    write(find(slide, 11), [TITLE], 13, bold_first=True)
    write(find(slide, 12), [PROBLEM], 8.5, space_after=0)
    write(find(slide, 14), SOLUTION, 11, space_after=7)
    write(find(slide, 15), WHY, 9.5, space_after=4)
    write(find(slide, 16), TECH, 9, space_after=1)
    write(find(slide, 17), [TEAM_MEMBERS], 9, space_after=0)
    write(find(slide, 20), [TEAM_NAME], 10, space_after=0)
    find(slide, 20).text_frame.paragraphs[0].runs[0].font.bold = True

    # Re-lay the proposed-solution area: text on the left, diagram on the right.
    body = find(slide, 14)
    body.left, body.top = Inches(0.45), Inches(1.62)
    body.width, body.height = Inches(4.55), Inches(3.20)

    why = find(slide, 15)
    why.left, why.top = Inches(0.22), Inches(5.56)
    why.width, why.height = Inches(6.55), Inches(1.75)

    name_box = find(slide, 20)
    name_box.width, name_box.height = Inches(1.96), Inches(0.26)
    name_box.top = Inches(0.30)
    members = find(slide, 17)
    members.top, members.height = Inches(0.56), Inches(0.42)

    tech = find(slide, 16)
    tech.left, tech.top = Inches(7.22), Inches(5.54)
    tech.width, tech.height = Inches(2.66), Inches(1.78)

    if os.path.exists(DIAGRAM):
        slide.shapes.add_picture(
            DIAGRAM, Inches(5.18), Inches(1.72), width=Inches(4.55), height=Inches(2.90)
        )

    out = sys.argv[1] if len(sys.argv) > 1 else "Encode PS 3 - HMI Copilot.pptx"
    prs.save(out)
    print("wrote", os.path.abspath(out))


if __name__ == "__main__":
    main()
