#!/usr/bin/env python3
"""Sample projects: a tag export and the prompts that go with it, per plant.

These live in `samples/` at the repository root and are **deliberately not
served by the app**. `web/public/demo/` holds the ones the Tags screen offers
with one click; these are for testing the upload path the way an engineer
actually uses it - pick a file, watch it parse, watch the corrections get
reported.

Seven plants, chosen to cover different equipment rather than different sizes:

    beverage-plant          ~155   the showcase sample - six areas, twelve
                                   kinds of machine, every object readable
    transfer-pump-station    20    the smallest thing worth a screen
    boiler-house             93    boilers, feedwater, combustion air
    packaging-line          124    conveyors, filler, capper, labeller
    tank-farm               129    storage, transfer, loading
    hvac-building           148    air handling, chillers, chilled water
    water-treatment         174    intake, filtration, dosing, distribution
    chemical-plant          718    eight areas - the one that needs a hierarchy

Every name is in the shape `web/src/lib/ai/infer.ts` parses: a machine prefix it
knows, a loop number, and a role suffix. That is not decoration - equipment is
inferred from these names, and a list that named things some other way would
make the inference look worse than it is.

Each plant also carries a few names a real export carries and OTE will not
accept. The importer reports its corrections rather than applying them silently,
and that beat needs something to report.

    python tools/make_sample_projects.py
    python tools/make_sample_projects.py --check    # summarise, write nothing
"""

from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples"

# --- tag shapes ---------------------------------------------------------
#
# Suffixes match lib/ai/infer.ts: _RUN and _FLT name a role, _PV is a reading,
# _HI/_LO are switches, _SP a setpoint. Anything else rides along as a plain tag.

MOTORISED = [
    ("RUN", "Bool", "{label} running"),
    ("FLT", "Bool", "{label} fault"),
    ("AVAIL", "Bool", "{label} available"),
    ("START", "Bool", "{label} start command"),
    ("STOP", "Bool", "{label} stop command"),
    ("HRS", "Real", "{label} run hours"),
]

WITH_VSD = MOTORISED + [
    ("SPD", "Real", "{label} speed feedback percent"),
    ("SPD_SP", "Real", "{label} speed setpoint percent"),
    ("AMPS", "Real", "{label} motor current A"),
]

VALVE = [
    ("OPEN", "Bool", "{label} open feedback"),
    ("CLOSED", "Bool", "{label} closed feedback"),
    ("CMD", "Bool", "{label} open command"),
    ("FLT", "Bool", "{label} fault"),
]

CONTROL_VALVE = [
    ("PV", "Real", "{label} position percent"),
    ("SP", "Real", "{label} position setpoint percent"),
    ("FLT", "Bool", "{label} fault"),
]

# Instrument first letter -> what it measures and the unit its comment carries.
# lib/ote/layout.ts reads the unit out of the comment to label the reading.
INSTRUMENT = {
    "F": ("flow", "LPM"),
    "L": ("level", "percent"),
    "P": ("pressure", "bar"),
    "T": ("temperature", "degC"),
    "A": ("analysis", "pH"),
    "S": ("speed", "rpm"),
}

SWITCH_WORD = {"HI": "high", "HH": "high high", "LO": "low", "LL": "low low"}


def machine(prefix: str, loop: int, label: str, template=MOTORISED) -> list[tuple]:
    return [
        (f"{prefix}_{loop}_{suffix}", kind, comment.format(label=label))
        for suffix, kind, comment in template
    ]


def instrument(
    letter: str, loop: int, label: str, switches: tuple[str, ...] = (), unit: str | None = None
) -> list[tuple]:
    measured, default_unit = INSTRUMENT[letter]
    rows = [(f"{letter}T_{loop}_PV", "Real", f"{label} {measured} {unit or default_unit}")]
    for switch in switches:
        rows.append(
            (f"{letter}T_{loop}_{switch}", "Bool", f"{label} {measured} {SWITCH_WORD[switch]}")
        )
    return rows


def tank(loop: int, label: str, switches: tuple[str, ...] = ("HI", "LO")) -> list[tuple]:
    rows = [
        (f"TNK_{loop}_LEVEL", "Real", f"{label} level percent"),
        (f"TNK_{loop}_VOL", "Real", f"{label} volume m3"),
    ]
    rows += instrument("L", loop, label, switches)
    return rows


def valve(loop: int, label: str, template=VALVE) -> list[tuple]:
    return [
        (f"VLV_{loop}_{suffix}", kind, comment.format(label=label))
        for suffix, kind, comment in template
    ]


def address(index: int, data_type: str) -> str:
    """A plausible Unity address, so the Address column is not empty."""
    if data_type == "Bool":
        return f"%MX{500 + index // 8}.{index % 8}"
    if data_type in ("Int", "Word"):
        return f"%MW{2000 + index}"
    return f"%MD{4000 + index * 2}"


# --- plants -------------------------------------------------------------


@dataclass
class Plant:
    slug: str
    title: str
    summary: str
    areas: list[str]
    intent: str
    intent_full: str | None
    follow_ups: list[str]
    rows: list[tuple] = field(default_factory=list)
    #: What the whole-application prompt actually produced, measured through
    #: POST /api/generate rather than predicted. Absent where it has not been
    #: run - an unmeasured figure in a README is worse than no figure.
    produced: str | None = None


def transfer_pump_station() -> Plant:
    rows: list[tuple] = []
    for loop, label in ((101, "Transfer pump 1"), (102, "Transfer pump 2")):
        rows += machine("PMP", loop, label)
    rows += instrument("F", 101, "Discharge header", ("LO",))
    rows += tank(101, "Break tank")
    rows.append(("PMP 103 RUN", "Bool", "Standby pump running"))

    return Plant(
        slug="transfer-pump-station",
        title="Transfer pump station",
        summary=(
            "Two duty transfer pumps, a standby, and the break tank they draw "
            "from. The smallest thing worth a screen, and small enough that "
            "every object on the generated screen can be read from the back of "
            "a room."
        ),
        areas=["Transfer pumps", "Break tank"],
        intent=(
            "Create a transfer pump station screen. Show which pump is running, "
            "flag any fault, display the discharge flow and the break tank "
            "level, and warn before the tank overfills."
        ),
        intent_full=None,
        follow_ups=[
            "make the fault lamps red when they are off as well",
            "move the flow reading above the level reading",
            "add a high alarm on the break tank at 85 percent",
        ],
        rows=rows,
    )


def boiler_house() -> Plant:
    rows: list[tuple] = []
    for n, loop in ((1, 101), (2, 102)):
        rows += [
            (f"BLR_{loop}_RUN", "Bool", f"Boiler {n} firing"),
            (f"BLR_{loop}_FLT", "Bool", f"Boiler {n} fault"),
            (f"BLR_{loop}_AVAIL", "Bool", f"Boiler {n} available"),
            (f"BLR_{loop}_LOCKOUT", "Bool", f"Boiler {n} burner lockout"),
            (f"BLR_{loop}_FLAME", "Bool", f"Boiler {n} flame proven"),
            (f"BLR_{loop}_HRS", "Real", f"Boiler {n} run hours"),
            (f"BLR_{loop}_MOD", "Real", f"Boiler {n} burner modulation percent"),
        ]
        rows += instrument("P", loop, f"Boiler {n} steam", ("HI", "HH", "LO"), "bar")
        rows += instrument("T", loop, f"Boiler {n} flue gas", ("HI",), "degC")
        rows += instrument("L", loop, f"Boiler {n} drum", ("HI", "LO", "LL"))
        rows += instrument("F", loop, f"Boiler {n} steam", unit="kg/h")
        rows += machine("FAN", loop, f"Boiler {n} combustion air fan", WITH_VSD)

    for loop, label in ((201, "Feedwater pump 1"), (202, "Feedwater pump 2")):
        rows += machine("PMP", loop, label, WITH_VSD)
    rows += instrument("P", 201, "Feedwater header", ("LO",), "bar")
    rows += instrument("T", 201, "Feedwater", unit="degC")
    rows += tank(201, "Deaerator")

    rows += valve(301, "Fuel gas valve")
    rows += valve(302, "Fuel oil valve")
    rows += instrument("P", 301, "Fuel gas", ("LO",), "bar")

    rows += [
        ("HOUSE_MODE", "Int", "Boiler house mode 0 off 1 lead 2 lag"),
        ("HOUSE_LEAD", "Int", "Lead boiler number"),
        ("STEAM HEADER PRESSURE", "Real", "Header pressure bar"),
    ]

    return Plant(
        slug="boiler-house",
        title="Boiler house",
        summary=(
            "Two shell boilers with their own combustion air fans, a shared "
            "feedwater set and deaerator, and dual-fuel supply. Enough "
            "equipment that one screen would be the wrong answer."
        ),
        areas=["Boiler 1", "Boiler 2", "Feedwater and deaerator", "Fuel supply"],
        intent=(
            "Build the boiler house screen showing both boilers - firing status, "
            "steam pressure, drum level and flue gas temperature - with the "
            "combustion air fans and a high steam pressure alarm."
        ),
        intent_full=(
            "Build the operator screens for the boiler house: a plant overview, "
            "then a screen for each boiler and one for the feedwater and "
            "deaerator system."
        ),
        follow_ups=[
            "put the drum level alarms on: high at 80 percent and low at 20",
            "add steam pressure to each boiler tile on the overview",
            "the flue gas temperature should read in a larger font",
        ],
        rows=rows,
    )


def hvac_building() -> Plant:
    rows: list[tuple] = []

    for n, loop in ((1, 101), (2, 102), (3, 103)):
        rows += machine("FAN", loop, f"AHU {n} supply fan", WITH_VSD)
        rows += machine("FAN", loop + 10, f"AHU {n} return fan", WITH_VSD)
        rows += instrument("T", loop, f"AHU {n} supply air", ("HI", "LO"), "degC")
        rows += instrument("T", loop + 10, f"AHU {n} return air", unit="degC")
        rows += instrument("P", loop, f"AHU {n} filter differential", ("HI",), "Pa")
        rows += valve(loop, f"AHU {n} cooling coil valve", CONTROL_VALVE)
        rows += valve(loop + 10, f"AHU {n} heating coil valve", CONTROL_VALVE)
        rows += [
            (f"AHU_{loop}_DAMPER_PV", "Real", f"AHU {n} fresh air damper percent"),
            (f"AHU_{loop}_DAMPER_SP", "Real", f"AHU {n} fresh air damper setpoint percent"),
            (f"AHU_{loop}_OCC", "Bool", f"AHU {n} occupied"),
        ]

    for loop, label in ((201, "Chiller 1"), (202, "Chiller 2")):
        rows += machine("CHL", loop, label, WITH_VSD)
        rows += instrument("T", loop, f"{label} chilled water flow", unit="degC")
        rows += instrument("P", loop, f"{label} head", ("HI",), "bar")

    for loop, label in ((301, "Chilled water pump 1"), (302, "Chilled water pump 2")):
        rows += machine("PMP", loop, label, WITH_VSD)
    rows += instrument("F", 301, "Chilled water", unit="LPM")
    rows += instrument("P", 301, "Chilled water differential", ("LO",), "bar")

    rows += [
        ("BLDG_OCCUPIED", "Bool", "Building occupied"),
        ("BLDG_MODE", "Int", "Building mode 0 off 1 occupied 2 setback"),
        ("BLDG-OUTSIDE-TEMP", "Real", "Outside air temperature degC"),
        ("BLDG_ALARM_COUNT", "Int", "Active alarm count"),
    ]

    return Plant(
        slug="hvac-building",
        title="Building HVAC",
        summary=(
            "Three air handling units with supply and return fans, coil control "
            "valves and dampers, two chillers, and the chilled water set that "
            "serves them. Instruments rather than machines dominate here, which "
            "is a different shape from a process plant."
        ),
        areas=["AHU 1", "AHU 2", "AHU 3", "Chillers", "Chilled water"],
        intent=(
            "Create an HVAC screen for the three air handling units showing "
            "supply and return fan status, supply air temperature, filter "
            "differential pressure and damper position."
        ),
        intent_full=(
            "Build the building HVAC screens: an overview, then a screen for "
            "each air handling unit and one for the chillers and chilled water "
            "distribution."
        ),
        follow_ups=[
            "add a dirty filter alarm on every AHU",
            "put the outside air temperature in the header",
            "group the supply and return fan lamps on each unit",
        ],
        rows=rows,
    )


def packaging_line() -> Plant:
    rows: list[tuple] = []

    conveyors = [
        (101, "Infeed conveyor"),
        (102, "Filler conveyor"),
        (103, "Capper conveyor"),
        (104, "Labeller conveyor"),
        (105, "Outfeed conveyor"),
    ]
    for loop, label in conveyors:
        rows += machine("CNV", loop, label, WITH_VSD)
        rows += [(f"CNV_{loop}_JAM", "Bool", f"{label} jam detected")]

    for loop, label in ((201, "Filler"), (202, "Capper"), (203, "Labeller")):
        rows += machine("MTR", loop, label, WITH_VSD)
        rows += [
            (f"MTR_{loop}_COUNT", "Dint", f"{label} unit count"),
            (f"MTR_{loop}_REJECT", "Dint", f"{label} reject count"),
            (f"MTR_{loop}_READY", "Bool", f"{label} ready"),
        ]

    rows += instrument("F", 201, "Product fill", ("LO",), "LPM")
    rows += instrument("P", 201, "Product supply", ("LO",), "bar")
    rows += instrument("T", 201, "Product", unit="degC")
    rows += tank(201, "Product buffer tank")

    rows += valve(301, "Product supply valve")
    rows += valve(302, "CIP supply valve")

    for loop, label in ((401, "Vacuum pump"), (402, "CIP pump")):
        rows += machine("PMP", loop, label)

    rows += [
        ("LINE_RUNNING", "Bool", "Line running"),
        ("LINE_ESTOP", "Bool", "Emergency stop healthy"),
        ("LINE_MODE", "Int", "Line mode 0 stop 1 run 2 CIP"),
        ("LINE_RATE", "Real", "Line rate units per minute"),
        ("LINE_OEE", "Real", "Overall equipment effectiveness percent"),
        ("BATCH_ID", "String", "Current batch identifier"),
        ("MTR-501-RUN", "Bool", "Palletiser running"),
        ("2ND_SHIFT_COUNT", "Dint", "Second shift unit count"),
    ]

    return Plant(
        slug="packaging-line",
        title="Packaging line",
        summary=(
            "Five conveyors and three machines in sequence, with counts, reject "
            "counts and a line rate. A discrete line rather than a process "
            "plant: what matters here is throughput and where it stopped."
        ),
        areas=["Conveyors", "Filler", "Capper", "Labeller", "CIP"],
        intent=(
            "Create an operator screen for the packaging line showing each "
            "conveyor's run status and speed, the filler, capper and labeller "
            "with their unit counts, and the line rate."
        ),
        intent_full=(
            "Build the packaging line screens: a line overview, then a screen "
            "for the conveyors and one for the filler, capper and labeller."
        ),
        follow_ups=[
            "add a jam alarm on every conveyor",
            "put the line rate and OEE in the header, large",
            "group the three machine faceplates and move them to the top",
        ],
        rows=rows,
    )


def tank_farm() -> Plant:
    rows: list[tuple] = []

    for n in range(1, 7):
        loop = 100 + n
        rows += tank(loop, f"Storage tank {n}", ("HI", "HH", "LO", "LL"))
        rows += instrument("T", loop, f"Storage tank {n}", unit="degC")
        rows += instrument("P", loop, f"Storage tank {n} vapour", ("HI",), "bar")
        rows += valve(loop, f"Tank {n} outlet valve")

    for loop, label in (
        (201, "Transfer pump 1"),
        (202, "Transfer pump 2"),
        (203, "Loading pump"),
    ):
        rows += machine("PMP", loop, label, WITH_VSD)

    rows += instrument("F", 201, "Transfer header", ("LO",), "m3/h")
    rows += instrument("F", 202, "Loading arm", unit="m3/h")
    rows += instrument("P", 201, "Transfer header", ("HI", "LO"), "bar")
    rows += valve(301, "Loading arm valve")
    rows += valve(302, "Recirculation valve", CONTROL_VALVE)

    rows += [
        ("FARM_MODE", "Int", "Tank farm mode 0 idle 1 transfer 2 loading"),
        ("FARM_ACTIVE_TANK", "Int", "Tank currently selected"),
        ("FARM_TOTALISER", "Real", "Loading totaliser m3"),
        ("FARM_ESTOP", "Bool", "Emergency stop healthy"),
        ("TIME", "Real", "Batch elapsed time seconds"),
    ]

    return Plant(
        slug="tank-farm",
        title="Tank farm",
        summary=(
            "Six storage tanks with level, temperature and vapour pressure, "
            "their outlet valves, and the transfer and loading pumps that move "
            "product between them. Level alarms are the whole point here - four "
            "per tank."
        ),
        areas=["Storage tanks", "Transfer", "Loading"],
        intent=(
            "Create a tank farm screen showing all six storage tanks with their "
            "levels and temperatures, the transfer pumps, and high and low level "
            "alarms on every tank."
        ),
        intent_full=(
            "Build the tank farm screens: an overview showing every tank level, "
            "then a screen for the storage tanks and one for transfer and "
            "loading."
        ),
        follow_ups=[
            "add high high alarms on all six tanks at 95 percent",
            "show the loading totaliser in the header",
            "line the six tank faceplates up in two rows of three",
        ],
        rows=rows,
    )


def water_treatment() -> Plant:
    rows: list[tuple] = []

    for loop, label in (
        (101, "Intake pump 1"),
        (102, "Intake pump 2"),
        (103, "Intake pump 3"),
    ):
        rows += machine("PMP", loop, label, WITH_VSD)
    rows += instrument("F", 101, "Raw water intake", ("LO",), "LPM")
    rows += instrument("P", 101, "Intake header", unit="bar")
    rows += tank(101, "Wet well", ("HI", "HH", "LO"))

    for n in range(1, 5):
        loop = 200 + n
        rows += machine("FIL", loop, f"Filter {n}")
        rows += instrument("P", loop, f"Filter {n} differential", ("HI",), "bar")
        rows += instrument("F", loop, f"Filter {n} outlet", unit="LPM")
        rows += valve(loop, f"Filter {n} inlet valve")
        rows += [(f"FIL_{loop}_BW_ACTIVE", "Bool", f"Filter {n} backwash in progress")]

    for loop, label in ((301, "Backwash pump 1"), (302, "Backwash pump 2")):
        rows += machine("PMP", loop, label)
    rows += instrument("F", 301, "Backwash header", unit="LPM")

    for loop, label in ((401, "Chlorine dosing pump"), (402, "Coagulant dosing pump")):
        rows += machine("DOS", loop, label, WITH_VSD)
    rows += instrument("A", 401, "Final water chlorine", ("HI", "LO"), "mg/l")
    rows += instrument("A", 402, "Final water", ("HI", "LO"), "pH")
    rows += instrument("T", 401, "Final water", unit="degC")
    rows += tank(401, "Chlorine day tank", ("LO", "LL"))
    rows += tank(402, "Coagulant day tank", ("LO", "LL"))

    for loop, label in ((501, "Distribution pump 1"), (502, "Distribution pump 2")):
        rows += machine("PMP", loop, label, WITH_VSD)
    rows += tank(501, "Clear well", ("HI", "LO"))
    rows += instrument("P", 501, "Distribution header", ("HI", "LO"), "bar")
    rows += instrument("F", 501, "Distribution", unit="LPM")

    rows += [
        ("PLANT_RUNNING", "Bool", "Plant in auto"),
        ("PLANT_ESTOP", "Bool", "Emergency stop healthy"),
        ("PLANT_MODE", "Int", "Plant mode 0 manual 1 auto 2 backwash"),
        ("PLANT_ALARM_COUNT", "Int", "Active alarm count"),
        ("PMP 601 RUN", "Bool", "Spare pump running"),
        ("VLV-601-OPEN", "Bool", "Spare valve open"),
        ("1ST_STAGE_FLOW", "Real", "First stage flow LPM"),
    ]

    return Plant(
        slug="water-treatment",
        title="Water treatment works",
        summary=(
            "Intake, four rapid gravity filters with backwash, chemical dosing "
            "and distribution. Four distinct areas, which is the smallest plant "
            "where the ISA-101 hierarchy earns its place."
        ),
        areas=["Intake", "Filtration", "Backwash", "Chemical dosing", "Distribution"],
        intent=(
            "Create a screen for the intake area showing all three intake pumps, "
            "the raw water flow and the wet well level with high and low alarms."
        ),
        intent_full=(
            "Generate the whole HMI for this water treatment works - a plant "
            "overview, then a screen for each area: intake, filtration, "
            "chemical dosing and distribution."
        ),
        follow_ups=[
            "the chlorine and coagulant day tanks need low level alarms",
            "put the four filters on their own screen showing differential pressure",
            "add a second screen for backwash",
        ],
        rows=rows,
    )


def chemical_plant() -> Plant:
    """The complex one: eight areas, and no single screen could hold it."""
    rows: list[tuple] = []

    # --- 1000s intake and raw material tank farm ------------------------
    for n in range(1, 7):
        loop = 1000 + n
        rows += tank(loop, f"Raw material tank {n}", ("HI", "HH", "LO", "LL"))
        rows += instrument("T", loop, f"Raw material tank {n}", unit="degC")
        rows += valve(loop, f"Raw material tank {n} outlet valve")
    for n, loop in ((1, 1101), (2, 1102), (3, 1103)):
        rows += machine("PMP", loop, f"Raw material transfer pump {n}", WITH_VSD)
    rows += instrument("F", 1101, "Raw material transfer", ("LO",), "m3/h")
    rows += instrument("P", 1101, "Raw material header", ("HI", "LO"), "bar")

    # --- 2000s reactor train --------------------------------------------
    for n in range(1, 5):
        loop = 2000 + n
        rows += [
            (f"RCT_{loop}_RUN", "Bool", f"Reactor {n} batch running"),
            (f"RCT_{loop}_FLT", "Bool", f"Reactor {n} fault"),
            (f"RCT_{loop}_AVAIL", "Bool", f"Reactor {n} available"),
            (f"RCT_{loop}_STEP", "Int", f"Reactor {n} batch step number"),
            (f"RCT_{loop}_HRS", "Real", f"Reactor {n} run hours"),
        ]
        rows += instrument("T", loop, f"Reactor {n}", ("HI", "HH"), "degC")
        rows += instrument("P", loop, f"Reactor {n}", ("HI", "HH"), "bar")
        rows += instrument("L", loop, f"Reactor {n}", ("HI", "LO"))
        rows += instrument("A", loop, f"Reactor {n}", ("HI", "LO"), "pH")
        rows += machine("MTR", loop, f"Reactor {n} agitator", WITH_VSD)
        rows += valve(loop, f"Reactor {n} jacket steam valve", CONTROL_VALVE)
        rows += valve(loop + 50, f"Reactor {n} jacket cooling valve", CONTROL_VALVE)
        rows += valve(loop + 100, f"Reactor {n} discharge valve")
        for d in (1, 2):
            rows += machine("DOS", loop * 10 + d, f"Reactor {n} doser {d}", WITH_VSD)

    # --- 3000s distillation ---------------------------------------------
    for n in (1, 2):
        loop = 3000 + n
        rows += [
            (f"CNV_{loop}_RUN", "Bool", f"Column {n} feed conveyor running"),
            (f"CNV_{loop}_FLT", "Bool", f"Column {n} feed conveyor fault"),
        ]
        rows += instrument("T", loop, f"Column {n} top", ("HI",), "degC")
        rows += instrument("T", loop + 50, f"Column {n} bottom", ("HI",), "degC")
        rows += instrument("P", loop, f"Column {n}", ("HI", "HH"), "bar")
        rows += instrument("L", loop, f"Column {n} sump", ("HI", "LO"))
        rows += instrument("F", loop, f"Column {n} reflux", ("LO",), "m3/h")
        rows += machine("PMP", loop, f"Column {n} reflux pump", WITH_VSD)
        rows += machine("PMP", loop + 50, f"Column {n} bottoms pump", WITH_VSD)
        rows += machine("HTR", loop, f"Column {n} reboiler")
        rows += valve(loop, f"Column {n} reflux valve", CONTROL_VALVE)

    # --- 4000s utilities: boilers, chillers, air ------------------------
    for n, loop in ((1, 4001), (2, 4002)):
        rows += [
            (f"BLR_{loop}_RUN", "Bool", f"Utility boiler {n} firing"),
            (f"BLR_{loop}_FLT", "Bool", f"Utility boiler {n} fault"),
            (f"BLR_{loop}_MOD", "Real", f"Utility boiler {n} modulation percent"),
        ]
        rows += instrument("P", loop, f"Utility boiler {n} steam", ("HI", "LO"), "bar")
        rows += instrument("L", loop, f"Utility boiler {n} drum", ("HI", "LO", "LL"))
        rows += machine("FAN", loop, f"Utility boiler {n} air fan", WITH_VSD)
    for n, loop in ((1, 4101), (2, 4102)):
        rows += machine("CMP", loop, f"Air compressor {n}", WITH_VSD)
        rows += instrument("P", loop, f"Air compressor {n} discharge", ("LO",), "bar")
    for n, loop in ((1, 4201), (2, 4202)):
        rows += machine("CHL", loop, f"Chiller {n}", WITH_VSD)
        rows += instrument("T", loop, f"Chiller {n} chilled water", ("HI",), "degC")
    for loop, label in ((4301, "Cooling water pump 1"), (4302, "Cooling water pump 2")):
        rows += machine("PMP", loop, label, WITH_VSD)
    rows += instrument("F", 4301, "Cooling water", ("LO",), "m3/h")
    rows += instrument("T", 4301, "Cooling water return", ("HI",), "degC")

    # --- 5000s CIP -------------------------------------------------------
    for loop, label in ((5001, "CIP supply pump"), (5002, "CIP return pump")):
        rows += machine("PMP", loop, label, WITH_VSD)
    rows += tank(5001, "CIP caustic tank", ("LO", "LL"))
    rows += tank(5002, "CIP acid tank", ("LO", "LL"))
    rows += tank(5003, "CIP rinse water tank", ("LO",))
    rows += instrument("T", 5001, "CIP supply", ("LO",), "degC")
    rows += instrument("A", 5001, "CIP return conductivity", ("HI", "LO"), "mS/cm")
    rows += instrument("F", 5001, "CIP supply", ("LO",), "LPM")
    for n in range(1, 4):
        rows += valve(5000 + n, f"CIP circuit {n} valve")
    rows += [
        ("CIP_RUN", "Bool", "CIP sequence running"),
        ("CIP_STEP", "Int", "CIP step number"),
        ("CIP_CIRCUIT", "Int", "CIP circuit selected"),
    ]

    # --- 6000s packaging -------------------------------------------------
    for n in range(1, 5):
        loop = 6000 + n
        rows += machine("CNV", loop, f"Packaging conveyor {n}", WITH_VSD)
        rows += [(f"CNV_{loop}_JAM", "Bool", f"Packaging conveyor {n} jam detected")]
    for loop, label in ((6101, "Filler"), (6102, "Capper"), (6103, "Palletiser")):
        rows += machine("MTR", loop, label, WITH_VSD)
        rows += [
            (f"MTR_{loop}_COUNT", "Dint", f"{label} unit count"),
            (f"MTR_{loop}_REJECT", "Dint", f"{label} reject count"),
        ]
    rows += tank(6101, "Packaging buffer tank")
    rows += instrument("F", 6101, "Packaging fill", ("LO",), "LPM")

    # --- 7000s effluent treatment ---------------------------------------
    for loop, label in ((7001, "Effluent lift pump 1"), (7002, "Effluent lift pump 2")):
        rows += machine("PMP", loop, label, WITH_VSD)
    for n in (1, 2):
        rows += machine("FIL", 7100 + n, f"Effluent filter {n}")
        rows += instrument("P", 7100 + n, f"Effluent filter {n} differential", ("HI",), "bar")
    rows += machine("DOS", 7201, "Effluent neutralising doser", WITH_VSD)
    rows += tank(7001, "Effluent balance tank", ("HI", "HH", "LO"))
    rows += instrument("A", 7001, "Effluent discharge", ("HI", "LO"), "pH")
    rows += instrument("F", 7001, "Effluent discharge", ("HI",), "m3/h")
    rows += instrument("T", 7001, "Effluent", unit="degC")

    # --- 8000s power distribution ---------------------------------------
    for n in (1, 2):
        loop = 8000 + n
        rows += [
            (f"MTR_{loop}_RUN", "Bool", f"Generator {n} running"),
            (f"MTR_{loop}_FLT", "Bool", f"Generator {n} fault"),
            (f"MTR_{loop}_AVAIL", "Bool", f"Generator {n} available"),
            (f"MTR_{loop}_KW", "Real", f"Generator {n} load kW"),
            (f"MTR_{loop}_HRS", "Real", f"Generator {n} run hours"),
        ]
    rows += [
        ("PWR_MAINS_HEALTHY", "Bool", "Mains supply healthy"),
        ("PWR_TOTAL_KW", "Real", "Total plant load kW"),
        ("PWR_POWER_FACTOR", "Real", "Plant power factor"),
        ("PWR_FREQUENCY", "Real", "Supply frequency Hz"),
    ]

    # --- plant-wide, and the awkward names ------------------------------
    rows += [
        ("PLANT_RUNNING", "Bool", "Plant in auto"),
        ("PLANT_ESTOP", "Bool", "Emergency stop healthy"),
        ("PLANT_MODE", "Int", "Plant mode 0 manual 1 auto 2 shutdown"),
        ("PLANT_ALARM_COUNT", "Int", "Active alarm count"),
        ("PLANT_BATCH_ID", "String", "Current batch identifier"),
        ("PMP 9001 RUN", "Bool", "Spare pump running"),
        ("VLV-9001-OPEN", "Bool", "Spare valve open"),
        ("3RD_PARTY_FLOW", "Real", "Third party metered flow m3/h"),
        # TIME is an IEC data type, so OTE rejects it as a variable name - and
        # it is exactly the name an engineer reaches for.
        ("TIME", "Real", "Plant cycle time seconds"),
    ]

    return Plant(
        slug="chemical-plant",
        title="Chemical plant",
        summary=(
            "Eight areas: raw material tank farm, a four-reactor batch train, "
            "two distillation columns, utilities, CIP, packaging, effluent "
            "treatment and power distribution. This is the one that cannot be "
            "one screen - it is the case ISA-101's display hierarchy exists for, "
            "and the one that shows what the planner does when a request is "
            "larger than a display."
        ),
        areas=[
            "Raw material tank farm",
            "Reactor train",
            "Distillation",
            "Utilities",
            "CIP",
            "Packaging",
            "Effluent treatment",
            "Power distribution",
        ],
        intent=(
            "Create a screen for the reactor train showing all four reactors - "
            "batch running, temperature, pressure and level - with their "
            "agitators and high temperature alarms."
        ),
        intent_full=(
            "Generate the whole operator interface for this chemical plant. I "
            "want a plant overview, then a screen for each area: the raw "
            "material tank farm, the reactor train, distillation, utilities, "
            "CIP, packaging, effluent treatment and power distribution."
        ),
        produced=(
            "10 screens, 585 objects, 176 alarms (138 bit, 38 level) and 285 "
            "bindings, in one run. Gemini split the tank farm across two screens "
            "of its own accord, because eleven tanks do not fit on one."
        ),
        follow_ups=[
            "add high temperature and high pressure alarms on all four reactors",
            "the utilities screen should show both boilers and both chillers",
            "add a screen for effluent treatment with the discharge pH",
            "put the total plant load and the active alarm count in the header",
        ],
        rows=rows,
    )



def beverage_plant() -> Plant:
    """The one the showcase runs on.

    Chosen against the demo rather than against the importer: every area is a
    thing an audience recognises without explanation, it is small enough that
    every object on a generated screen can be read from a projector, and
    between its six areas it contains twelve different kinds of machine - which
    is what puts twelve different shipped graphic objects on the board at once.
    """
    rows: list[tuple] = []

    # --- 1xx raw intake and storage -------------------------------------
    for loop, label in ((101, "Intake pump 1"), (102, "Intake pump 2")):
        rows += machine("PMP", loop, label)
    rows += tank(101, "Raw product silo", ("HI", "HH", "LO"))
    rows += instrument("F", 101, "Raw intake", ("LO",), "LPM")
    rows += valve(101, "Silo outlet valve")

    # --- 2xx pasteurising ------------------------------------------------
    rows += machine("HTR", 201, "Pasteuriser")
    rows += machine("PMP", 201, "Pasteuriser feed pump", WITH_VSD)
    rows += instrument("T", 201, "Pasteurise", ("HI", "LO"), "degC")
    rows += instrument("T", 202, "Regeneration outlet", unit="degC")
    rows += instrument("F", 201, "Pasteurised product", ("LO",), "LPM")
    rows += valve(201, "Divert valve")
    rows += valve(202, "Steam control valve", CONTROL_VALVE)
    rows += tank(201, "Balance tank")

    # --- 3xx blending ----------------------------------------------------
    for loop, label in ((301, "Blend vessel 1"), (302, "Blend vessel 2")):
        rows += machine("RCT", loop, label)
        rows += instrument("L", loop, label, ("HI", "LO"))
    rows += machine("MTR", 301, "Blend vessel 1 agitator", WITH_VSD)
    rows += machine("DOS", 301, "Flavour dosing pump", WITH_VSD)
    rows += instrument("A", 301, "Blended product", ("HI", "LO"), "pH")
    rows += valve(301, "Blend transfer valve")

    # --- 4xx clean in place ----------------------------------------------
    rows += machine("PMP", 401, "CIP supply pump", WITH_VSD)
    rows += tank(401, "CIP caustic tank", ("LO", "LL"))
    rows += tank(402, "CIP acid tank", ("LO", "LL"))
    rows += instrument("T", 401, "CIP supply", ("LO",), "degC")
    rows += instrument("A", 401, "CIP return conductivity", ("HI", "LO"), "mS/cm")
    rows += valve(401, "CIP circuit valve")
    rows += [
        ("CIP_RUN", "Bool", "CIP sequence running"),
        ("CIP_STEP", "Int", "CIP step number"),
    ]

    # --- 5xx filling and packaging ---------------------------------------
    for loop, label in ((501, "Infeed conveyor"), (502, "Outfeed conveyor")):
        rows += machine("CNV", loop, label, WITH_VSD)
        rows += [(f"CNV_{loop}_JAM", "Bool", f"{label} jam detected")]
    for loop, label in ((501, "Filler"), (502, "Capper")):
        rows += machine("MTR", loop, label, WITH_VSD)
        rows += [
            (f"MTR_{loop}_COUNT", "Dint", f"{label} unit count"),
            (f"MTR_{loop}_REJECT", "Dint", f"{label} reject count"),
        ]
    rows += instrument("F", 501, "Filler", ("LO",), "LPM")
    rows += tank(501, "Filler buffer tank")

    # --- 6xx utilities ----------------------------------------------------
    rows += [
        ("BLR_601_RUN", "Bool", "Steam boiler firing"),
        ("BLR_601_FLT", "Bool", "Steam boiler fault"),
        ("BLR_601_AVAIL", "Bool", "Steam boiler available"),
        ("BLR_601_MOD", "Real", "Steam boiler modulation percent"),
    ]
    rows += instrument("P", 601, "Steam header", ("HI", "LO"), "bar")
    rows += instrument("L", 601, "Boiler drum", ("LO", "LL"))
    rows += machine("FAN", 601, "Combustion air fan", WITH_VSD)
    rows += machine("CHL", 601, "Chiller", WITH_VSD)
    rows += instrument("T", 601, "Chilled water flow", ("HI",), "degC")
    rows += machine("CMP", 601, "Air compressor", WITH_VSD)
    rows += instrument("P", 602, "Compressed air", ("LO",), "bar")

    # --- plant wide, and the four names a real export carries --------------
    rows += [
        ("PLANT_RUNNING", "Bool", "Plant in auto"),
        ("PLANT_ESTOP", "Bool", "Emergency stop healthy"),
        ("PLANT_MODE", "Int", "Plant mode 0 manual 1 auto 2 CIP"),
        ("PLANT_BATCH_ID", "String", "Current batch identifier"),
        # One of each thing the importer has to report, so the correction beat
        # has all four categories in a single file.
        ("PMP 701 RUN", "Bool", "Spare pump running"),
        ("VLV-701-OPEN", "Bool", "Spare valve open"),
        ("2ND_STAGE_TEMP", "Real", "Second stage temperature degC"),
        ("TIME", "Real", "Batch elapsed time seconds"),
    ]

    return Plant(
        slug="beverage-plant",
        title="Beverage processing plant",
        summary=(
            "Intake and storage, pasteurising, blending, clean-in-place, "
            "filling and packaging, and the utilities that serve them. Built "
            "for the showcase: six areas an audience recognises without "
            "explanation, small enough that every object on a generated screen "
            "reads from a projector, and twelve different kinds of machine "
            "between them - which is twelve different shipped graphic objects "
            "on the board at once."
        ),
        areas=[
            "Raw intake and storage",
            "Pasteurising",
            "Blending",
            "Clean-in-place",
            "Filling and packaging",
            "Utilities",
        ],
        intent=(
            "Create a screen for the pasteuriser showing the feed pump, the "
            "pasteurise temperature with high and low alarms, the product flow "
            "and the divert valve."
        ),
        intent_full=(
            "Generate the operator screens for this beverage plant - a plant "
            "overview, then a screen for each area: raw intake, pasteurising, "
            "blending, clean-in-place, filling and packaging, and utilities."
        ),
        produced=(
            "7 screens, 374 objects, 49 alarms and 122 bindings, in one run - "
            "PlantOverview plus one screen per area, named as asked. On a "
            "machine with the library indexed it also placed 29 of the "
            "product's own graphic objects."
        ),
        follow_ups=[
            "add a low level alarm on both CIP tanks",
            "put the batch identifier and the line rate in the header",
            "the pasteurise temperature should read in a larger font",
            "add a screen for the blending vessels on their own",
        ],
        rows=rows,
    )


PLANTS = [
    beverage_plant,
    transfer_pump_station,
    boiler_house,
    hvac_building,
    packaging_line,
    tank_farm,
    water_treatment,
    chemical_plant,
]


# --- writing ------------------------------------------------------------


def write_tags(plant: Plant) -> Path:
    path = OUT / plant.slug / "tags.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Name", "DataType", "Comment", "Address"])
        for index, (tag, data_type, comment) in enumerate(plant.rows):
            writer.writerow([tag, data_type, comment, address(index, data_type)])
    return path


def counts(plant: Plant) -> dict[str, int]:
    out: dict[str, int] = {}
    for _, data_type, _ in plant.rows:
        out[data_type] = out.get(data_type, 0) + 1
    return out


def write_readme(plant: Plant) -> Path:
    path = OUT / plant.slug / "README.md"
    by_type = ", ".join(f"{n} {t}" for t, n in sorted(counts(plant).items()))
    awkward = [t for t, _, _ in plant.rows if not t.replace("_", "").isalnum() or t[0].isdigit()]

    lines = [
        f"# {plant.title}",
        "",
        plant.summary,
        "",
        f"**{len(plant.rows)} tags** — {by_type}",
        "",
        "## Areas",
        "",
    ]
    lines += [f"- {area}" for area in plant.areas]
    lines += [
        "",
        "## Import it",
        "",
        "Tags → drop `tags.csv` on the upload panel, or click to browse.",
        "",
    ]

    if awkward:
        lines += [
            "The importer will report corrections on these, rather than applying",
            "them silently:",
            "",
            "```",
        ]
        lines += awkward
        lines += ["```", ""]

    lines += [
        "## One screen",
        "",
        "```",
        plant.intent,
        "```",
        "",
    ]

    if plant.intent_full:
        lines += [
            "## The whole application",
            "",
            "```",
            plant.intent_full,
            "```",
            "",
        ]
        if plant.produced:
            lines += [f"Measured, not predicted: {plant.produced}", ""]
    else:
        lines += [
            "There is no whole-application prompt for this one on purpose. It is",
            "one station; a screen hierarchy over it would be padding.",
            "",
        ]

    lines += ["## Then keep going", ""]
    for follow in plant.follow_ups:
        lines += ["```", follow, "```", ""]

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_index(plants: list[Plant]) -> Path:
    path = OUT / "README.md"
    rows = "\n".join(
        f"| [`{p.slug}`]({p.slug}/) | {p.title} | {len(p.rows)} | {len(p.areas)} | {p.summary.split('.')[0]}. |"
        for p in plants
    )
    path.write_text(
        f"""# Sample projects

A tag export and the prompts that go with it, per plant. **These are not served
by the app.** `web/public/demo/` holds the samples the Tags screen offers with
one click; these are here to be uploaded by hand, which is the path an engineer
actually takes — pick a file, watch it parse, watch the corrections get
reported.

| Folder | Plant | Tags | Areas | What it is |
|---|---|---|---|---|
{rows}

Each folder holds two files:

- `tags.csv` — the export, `Name,DataType,Comment,Address`
- `README.md` — what the plant is, the prompt to start with, and follow-ups

## How to use one

1. **New** in the top bar — a blank project, which names itself once you ask
   for something.
2. **Tags** → drop that plant's `tags.csv` on the upload panel.
3. Back to the workspace, paste the prompt from its README, and keep going with
   the follow-ups.

## Why the names look like that

Equipment is inferred from tag names, not guessed: a machine prefix, a loop
number, and a role suffix. `PMP_101_RUN` is pump 101's running bit; `FT_101_PV`
is the flow transmitter on the same loop, and it folds into that pump because
they share the loop number. The prefixes `web/src/lib/ai/infer.ts` knows:

```
PMP PUMP P   pump       MTR MOT   motor      FAN       fan
VLV VAL      valve      TNK TK    tank       CMP       compressor
CHL CH       chiller
BLR BOILER   boiler     HTR       heater     FIL FLTR  filter
CNV CONV     conveyor   RCT REA   reactor    DOS       doser
```

and the ISA-5.1 instrument letters `F` flow, `L` level, `P` pressure, `T`
temperature, `A` analysis, `S` speed. Role suffixes: `_RUN` `_FLT` `_PV` `_SP`
`_HI` `_LO` `_CMD`.

Every plant also carries a few names a real export carries and OTE will not
accept — a space, a hyphen, a leading digit, a reserved word. The importer
reports its corrections rather than applying them silently, and that beat needs
something to report.

## Regenerating

```
python tools/make_sample_projects.py
python tools/make_sample_projects.py --check    # summarise, write nothing
```
""",
        encoding="utf-8",
    )
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="summarise, write nothing")
    args = parser.parse_args()

    plants = [build() for build in PLANTS]

    for plant in plants:
        names = [r[0] for r in plant.rows]
        duplicates = sorted({n for n in names if names.count(n) > 1})
        if duplicates:
            print(f"  ! {plant.slug}: duplicate tags {duplicates[:5]}", file=sys.stderr)
            return 1

    for plant in plants:
        if args.check:
            print(f"{plant.slug:24} {len(plant.rows):5} tags  {len(plant.areas)} areas")
            continue
        write_tags(plant)
        write_readme(plant)
        print(f"samples/{plant.slug:24} {len(plant.rows):5} tags  {len(plant.areas)} areas")

    if not args.check:
        write_index(plants)
        print(f"samples/README.md            {len(plants)} plants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
