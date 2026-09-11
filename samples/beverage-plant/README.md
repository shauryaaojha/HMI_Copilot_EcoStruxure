# Beverage processing plant

Intake and storage, pasteurising, blending, clean-in-place, filling and packaging, and the utilities that serve them. Built for the showcase: six areas an audience recognises without explanation, small enough that every object on a generated screen reads from a projector, and twelve different kinds of machine between them - which is twelve different shipped graphic objects on the board at once.

**228 tags** — 138 Bool, 4 Dint, 2 Int, 83 Real, 1 String

## Areas

- Raw intake and storage
- Pasteurising
- Blending
- Clean-in-place
- Filling and packaging
- Utilities

## Import it

Tags → drop `tags.csv` on the upload panel, or click to browse.

The importer will report corrections on these, rather than applying
them silently:

```
PMP 701 RUN
VLV-701-OPEN
2ND_STAGE_TEMP
```

## One screen

```
Create a screen for the pasteuriser showing the feed pump, the pasteurise temperature with high and low alarms, the product flow and the divert valve.
```

## The whole application

```
Generate the operator screens for this beverage plant - a plant overview, then a screen for each area: raw intake, pasteurising, blending, clean-in-place, filling and packaging, and utilities.
```

Measured, not predicted: 7 screens, 374 objects, 49 alarms and 122 bindings, in one run - PlantOverview plus one screen per area, named as asked. On a machine with the library indexed it also placed 29 of the product's own graphic objects.

## Then keep going

```
add a low level alarm on both CIP tanks
```

```
put the batch identifier and the line rate in the header
```

```
the pasteurise temperature should read in a larger font
```

```
add a screen for the blending vessels on their own
```
