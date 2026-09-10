# Transfer pump station

Two duty transfer pumps, a standby, and the break tank they draw from. The smallest thing worth a screen, and small enough that every object on the generated screen can be read from the back of a room.

**20 tags** — 14 Bool, 6 Real

## Areas

- Transfer pumps
- Break tank

## Import it

Tags → drop `tags.csv` on the upload panel, or click to browse.

The importer will report corrections on these, rather than applying
them silently:

```
PMP 103 RUN
```

## One screen

```
Create a transfer pump station screen. Show which pump is running, flag any fault, display the discharge flow and the break tank level, and warn before the tank overfills.
```

There is no whole-application prompt for this one on purpose. It is
one station; a screen hierarchy over it would be padding.

## Then keep going

```
make the fault lamps red when they are off as well
```

```
move the flow reading above the level reading
```

```
add a high alarm on the break tank at 85 percent
```
