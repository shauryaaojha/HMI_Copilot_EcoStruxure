# Packaging line

Five conveyors and three machines in sequence, with counts, reject counts and a line rate. A discrete line rather than a process plant: what matters here is throughput and where it stopped.

**124 tags** — 73 Bool, 7 Dint, 1 Int, 42 Real, 1 String

## Areas

- Conveyors
- Filler
- Capper
- Labeller
- CIP

## Import it

Tags → drop `tags.csv` on the upload panel, or click to browse.

The importer will report corrections on these, rather than applying
them silently:

```
MTR-501-RUN
2ND_SHIFT_COUNT
```

## One screen

```
Create an operator screen for the packaging line showing each conveyor's run status and speed, the filler, capper and labeller with their unit counts, and the line rate.
```

## The whole application

```
Build the packaging line screens: a line overview, then a screen for the conveyors and one for the filler, capper and labeller.
```

## Then keep going

```
add a jam alarm on every conveyor
```

```
put the line rate and OEE in the header, large
```

```
group the three machine faceplates and move them to the top
```
