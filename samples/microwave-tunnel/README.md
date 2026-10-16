# Microwave tempering tunnel

An industrial 915 MHz tunnel that tempers frozen meat blocks from -18 to about -4 degC: three 75 kW magnetron generators, the tunnel belt and its chilled air, a closed cooling water skid, and the leakage monitors and door interlocks that make up the safety chain.

**175 tags** — 100 Bool, 6 Int, 69 Real

## Areas

- Microwave generators
- Tunnel, conveyors and chilled air
- Cooling water skid
- Safety and power

## Import it

Tags → drop `tags.csv` on the upload panel, or click to browse.

The importer will report corrections on these, rather than applying
them silently:

```
Door 3 Open
2ND_SHIFT_COUNT
```

## One screen

```
Build one screen for the three microwave generators showing HV on, forward and reflected power, anode current and magnetron cooling water temperature and flow.
```

## The whole application

```
Build the operator screens for the microwave tempering tunnel: a plant overview, then a screen for the three microwave generators, one for the tunnel with its conveyors and chilled air, one for the cooling water skid, and one for safety and power.
```

## Then keep going

```
add a high alarm on each generator's reflected power at 15 kW
```

```
put the product outfeed temperature and total forward power on the overview
```

```
show the door switches and the safety chain as lamps
```
