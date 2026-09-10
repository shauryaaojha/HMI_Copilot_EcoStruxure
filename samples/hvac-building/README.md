# Building HVAC

Three air handling units with supply and return fans, coil control valves and dampers, two chillers, and the chilled water set that serves them. Instruments rather than machines dominate here, which is a different shape from a process plant.

**148 tags** — 72 Bool, 2 Int, 74 Real

## Areas

- AHU 1
- AHU 2
- AHU 3
- Chillers
- Chilled water

## Import it

Tags → drop `tags.csv` on the upload panel, or click to browse.

The importer will report corrections on these, rather than applying
them silently:

```
BLDG-OUTSIDE-TEMP
```

## One screen

```
Create an HVAC screen for the three air handling units showing supply and return fan status, supply air temperature, filter differential pressure and damper position.
```

## The whole application

```
Build the building HVAC screens: an overview, then a screen for each air handling unit and one for the chillers and chilled water distribution.
```

## Then keep going

```
add a dirty filter alarm on every AHU
```

```
put the outside air temperature in the header
```

```
group the supply and return fan lamps on each unit
```
