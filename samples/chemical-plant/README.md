# Chemical plant

Eight areas: raw material tank farm, a four-reactor batch train, two distillation columns, utilities, CIP, packaging, effluent treatment and power distribution. This is the one that cannot be one screen - it is the case ISA-101's display hierarchy exists for, and the one that shows what the planner does when a request is larger than a display.

**718 tags** — 422 Bool, 6 Dint, 8 Int, 281 Real, 1 String

## Areas

- Raw material tank farm
- Reactor train
- Distillation
- Utilities
- CIP
- Packaging
- Effluent treatment
- Power distribution

## Import it

Tags → drop `tags.csv` on the upload panel, or click to browse.

The importer will report corrections on these, rather than applying
them silently:

```
PMP 9001 RUN
VLV-9001-OPEN
3RD_PARTY_FLOW
```

## One screen

```
Create a screen for the reactor train showing all four reactors - batch running, temperature, pressure and level - with their agitators and high temperature alarms.
```

## The whole application

```
Generate the whole operator interface for this chemical plant. I want a plant overview, then a screen for each area: the raw material tank farm, the reactor train, distillation, utilities, CIP, packaging, effluent treatment and power distribution.
```

Measured, not predicted: 10 screens, 585 objects, 176 alarms (138 bit, 38 level) and 285 bindings, in one run. Gemini split the tank farm across two screens of its own accord, because eleven tanks do not fit on one.

## Then keep going

```
add high temperature and high pressure alarms on all four reactors
```

```
the utilities screen should show both boilers and both chillers
```

```
add a screen for effluent treatment with the discharge pH
```

```
put the total plant load and the active alarm count in the header
```
