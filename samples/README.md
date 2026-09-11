# Sample projects

A tag export and the prompts that go with it, per plant. **These are not served
by the app.** `web/public/demo/` holds the samples the Tags screen offers with
one click; these are here to be uploaded by hand, which is the path an engineer
actually takes — pick a file, watch it parse, watch the corrections get
reported.

| Folder | Plant | Tags | Areas | What it is |
|---|---|---|---|---|
| [`beverage-plant`](beverage-plant/) | Beverage processing plant | 228 | 6 | Intake and storage, pasteurising, blending, clean-in-place, filling and packaging, and the utilities that serve them. |
| [`transfer-pump-station`](transfer-pump-station/) | Transfer pump station | 20 | 2 | Two duty transfer pumps, a standby, and the break tank they draw from. |
| [`boiler-house`](boiler-house/) | Boiler house | 93 | 4 | Two shell boilers with their own combustion air fans, a shared feedwater set and deaerator, and dual-fuel supply. |
| [`hvac-building`](hvac-building/) | Building HVAC | 148 | 5 | Three air handling units with supply and return fans, coil control valves and dampers, two chillers, and the chilled water set that serves them. |
| [`packaging-line`](packaging-line/) | Packaging line | 124 | 5 | Five conveyors and three machines in sequence, with counts, reject counts and a line rate. |
| [`tank-farm`](tank-farm/) | Tank farm | 129 | 3 | Six storage tanks with level, temperature and vapour pressure, their outlet valves, and the transfer and loading pumps that move product between them. |
| [`water-treatment`](water-treatment/) | Water treatment works | 174 | 5 | Intake, four rapid gravity filters with backwash, chemical dosing and distribution. |
| [`chemical-plant`](chemical-plant/) | Chemical plant | 718 | 8 | Eight areas: raw material tank farm, a four-reactor batch train, two distillation columns, utilities, CIP, packaging, effluent treatment and power distribution. |

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
