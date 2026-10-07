/**
 * The machine library: what each kind of equipment is, as data.
 *
 * docs/REENGINEERING.md §3.2 calls equipment classes "the moat": the thing an
 * integrator library sells. A class says what roles a machine has (running,
 * fault, speed...), which of them are commands an operator may write and which
 * are readings, how the PLC usually spells each one - as a tag suffix *and* as
 * a DDT member name - which alarms it standardly raises at what ISA-18.2
 * priority, what a faceplate leads with and what is worth trending.
 *
 * Grounding, so none of it is invented:
 * - Role spellings come from the suffixes lib/ai/infer.ts already recognises
 *   from eight sample plants, widened with the member names Control Expert and
 *   Machine Expert function-block libraries conventionally use (Run, Flt,
 *   StartCmd, Spd, Pos...).
 * - Packaging machines follow ISA-TR88.00.02 (PackML): a machine is a state
 *   machine with 17 states and three standard modes, and PackTags name the
 *   signals (Status.StateCurrent, Command.CntrlCmd, Admin.ProdProcessedCount).
 * - Alarm priorities follow the ISA-18.2 shape: a safety or equipment-damage
 *   consequence is high, a production consequence medium, information low.
 *   They are defaults for an engineer to rationalise, never configuration.
 * - Every symbol named is one OTE 4.4 ships in its graphic object library
 *   (03-Icons), checked by tests/machines.test.ts against the local index.
 *
 * Customers add their own classes as data in the same shape; that is where
 * the product becomes theirs.
 */

export type Industry = "water" | "process" | "hvac" | "utilities" | "packaging" | "discrete" | "material-handling" | "power" | "food-bev";

export type SignalKind =
  /** A state the machine reports: BOOL. */
  | "status"
  /** Something the operator writes: BOOL pulse or INT command. */
  | "command"
  /** A measured analog value. */
  | "measure"
  /** An analog value the operator writes. */
  | "setpoint"
  /** A counter or totaliser. */
  | "count"
  /** A mode or step number. */
  | "state";

export type Priority = "high" | "medium" | "low";

export interface RoleSpec {
  /** The role name the generator and the faceplate use. Matches infer.ts roles where one exists. */
  role: string;
  kind: SignalKind;
  /** Upper-case words a tag ends with or a DDT member is called. */
  spellings: string[];
  /** Engineering unit, when the role has a conventional one. */
  unit?: string;
  /** A machine of this class without this role is unusual enough to report. */
  expected?: boolean;
}

export interface AlarmTemplate {
  role: string;
  /** "bit": the role is a BOOL that is the alarm. "hi"/"hihi"/"lo"/"lolo": a limit on an analog. */
  on: "bit" | "hi" | "hihi" | "lo" | "lolo";
  priority: Priority;
  /** "{label}" is replaced by the unit's label. */
  message: string;
  /** What happens if nobody acts: the consequence a rationalisation record asks for. */
  consequence: string;
  /** What the operator does. An alarm without an action is not an alarm (ISA-18.2). */
  action: string;
}

export interface MachineClass {
  id: string;
  name: string;
  industries: Industry[];
  /** ISA-88 physical-model level this is usually modelled at. */
  level: "control-module" | "equipment-module" | "unit";
  /** Tag prefixes (first word of the tag) that name this class. */
  prefixes: string[];
  /** Words in a DDT or function-block type name that name this class, lower case. */
  typeWords: string[];
  /** Words in a tag comment that suggest this class, lower case. */
  commentWords: string[];
  /** "Category/Name" in OTE's shipped 03-Icons library. */
  symbol?: string;
  roles: RoleSpec[];
  /** Faceplate order: what the machine is for first. */
  headline: string[];
  trends: string[];
  alarms: AlarmTemplate[];
  /** Follows the PackML state model (ISA-TR88.00.02). */
  packml?: boolean;
  description: string;
}

/* -------------------------------------------------------------- shared roles */

const R = {
  running: { role: "running", kind: "status", spellings: ["RUN", "RUNNING", "ON", "RUNFB", "RUN_FB"], expected: true },
  fault: { role: "fault", kind: "status", spellings: ["FLT", "FAULT", "TRIP", "TRIPPED", "ALM", "ALARM", "FAIL", "FAILURE"] },
  available: { role: "available", kind: "status", spellings: ["AVAIL", "AVAILABLE", "RDY", "READY", "HEALTHY"] },
  auto: { role: "mode", kind: "status", spellings: ["AUTO", "MODE", "MAN", "MANUAL", "REMOTE", "LOCAL", "HOA"] },
  start: { role: "command", kind: "command", spellings: ["START", "STARTCMD", "CMD", "RUNCMD", "CMD_START", "STR"] },
  stop: { role: "command", kind: "command", spellings: ["STOP", "STOPCMD", "CMD_STOP", "STP"] },
  reset: { role: "reset", kind: "command", spellings: ["RESET", "RST", "RESETCMD", "ACK"] },
  speed: { role: "speed", kind: "measure", spellings: ["SPD", "SPEED", "RPM", "SPDFB", "FREQ", "HZ"], unit: "%" },
  speedSp: { role: "setpoint", kind: "setpoint", spellings: ["SPDSP", "SPEEDSP", "SPD_SP", "SP", "SETPOINT", "REF", "SPEEDREF"], unit: "%" },
  current: { role: "current", kind: "measure", spellings: ["CUR", "CURRENT", "AMPS", "AMP", "I"], unit: "A" },
  power: { role: "power", kind: "measure", spellings: ["KW", "POWER", "PWR"], unit: "kW" },
  hours: { role: "hours", kind: "count", spellings: ["HRS", "HOURS", "RUNTIME", "RUNHRS", "OPHRS"], unit: "h" },
  starts: { role: "count", kind: "count", spellings: ["STARTS", "CNT", "COUNT"] },
  estop: { role: "estop", kind: "status", spellings: ["ESTOP", "EMSTOP", "EMERGENCYSTOP", "E_STOP"] },
  open: { role: "open", kind: "status", spellings: ["OPN", "OPEN", "OPENED", "ZSO", "OPENLS"], expected: true },
  closed: { role: "closed", kind: "status", spellings: ["CLS", "CLOSED", "CLOSE", "SHUT", "ZSC", "CLOSEDLS"], expected: true },
  openCmd: { role: "command", kind: "command", spellings: ["OPENCMD", "CMD_OPEN", "OPN_CMD", "OPENCMD"] },
  position: { role: "position", kind: "measure", spellings: ["POS", "POSITION", "ZT", "POSFB"], unit: "%" },
  positionSp: { role: "setpoint", kind: "setpoint", spellings: ["POSSP", "OUT", "CV", "OP", "DEMAND"], unit: "%" },
  level: { role: "level", kind: "measure", spellings: ["LVL", "LEVEL", "LT", "LIT"], unit: "%", expected: true },
  levelHi: { role: "high", kind: "status", spellings: ["HI", "HIGH", "LSH", "HH", "LSHH", "OVERFLOW"] },
  levelLo: { role: "low", kind: "status", spellings: ["LO", "LOW", "LSL", "LL", "LSLL", "EMPTY"] },
  temperature: { role: "temperature", kind: "measure", spellings: ["TMP", "TEMP", "TEMPERATURE", "TT", "TIT"], unit: "°C" },
  temperatureSp: { role: "setpoint", kind: "setpoint", spellings: ["TEMPSP", "TSP", "SP"], unit: "°C" },
  pressure: { role: "pressure", kind: "measure", spellings: ["PRS", "PRESS", "PRESSURE", "PT", "PIT"], unit: "bar" },
  flow: { role: "flow", kind: "measure", spellings: ["FLOW", "FLW", "FT", "FIT"], unit: "m³/h" },
  total: { role: "total", kind: "count", spellings: ["TOT", "TOTAL", "TOTALISER", "TOTALIZER", "FQ"] },
  dp: { role: "pressure", kind: "measure", spellings: ["DP", "DPT", "DIFFPRESS"], unit: "mbar" },
  vibration: { role: "vibration", kind: "measure", spellings: ["VIB", "VIBRATION", "VT"], unit: "mm/s" },
  weight: { role: "weight", kind: "measure", spellings: ["WT", "WEIGHT", "WGT", "MASS", "WIT"], unit: "kg" },
  step: { role: "step", kind: "state", spellings: ["STEP", "PHASE", "SEQ"] },
  state: { role: "state", kind: "state", spellings: ["STATE", "STATECURRENT", "STS", "STATUS"] },
  unitMode: { role: "mode", kind: "state", spellings: ["UNITMODE", "UNITMODECURRENT", "MODE"] },
  cntrlCmd: { role: "command", kind: "command", spellings: ["CNTRLCMD", "CMD", "COMMAND"] },
  machSpeed: { role: "speed", kind: "setpoint", spellings: ["MACHSPEED", "CURMACHSPEED", "SPEED", "RATE"], unit: "ppm" },
  produced: { role: "count", kind: "count", spellings: ["PRODPROCESSEDCOUNT", "PROCESSED", "GOOD", "COUNT", "CNT", "PRODUCED"] },
  rejects: { role: "count", kind: "count", spellings: ["PRODDEFECTIVECOUNT", "DEFECTIVE", "REJECTS", "REJECT", "BAD"] },
  efficiency: { role: "efficiency", kind: "measure", spellings: ["OEE", "EFF", "EFFICIENCY"], unit: "%" },
  jam: { role: "fault", kind: "status", spellings: ["JAM", "JAMMED", "BLOCKED", "STARVED"] },
  pv: { role: "value", kind: "measure", spellings: ["PV", "VAL", "VALUE", "IN"] },
  sp: { role: "setpoint", kind: "setpoint", spellings: ["SP", "SETPOINT"] },
  out: { role: "output", kind: "setpoint", spellings: ["OUT", "CV", "OP", "MV"], unit: "%" },
  pidMode: { role: "mode", kind: "state", spellings: ["MODE", "AUTO", "MAN", "CAS"] },
} satisfies Record<string, RoleSpec>;

const role = (r: RoleSpec, extra: Partial<RoleSpec> = {}): RoleSpec => ({ ...r, ...extra, spellings: [...r.spellings, ...(extra.spellings ?? [])] });

/* --------------------------------------------------------- standard alarms */

const motorAlarms = (what: string): AlarmTemplate[] => [
  { role: "fault", on: "bit", priority: "high", message: "{label} fault", consequence: `${what} stopped; the duty it serves is lost`, action: "Check the drive or starter fault code, reset when clear, start the standby if fitted" },
];

/** Only for classes that carry an estop role. */
const ESTOP_ALARM: AlarmTemplate = { role: "estop", on: "bit", priority: "high", message: "{label} emergency stop", consequence: "Machine stopped by an emergency stop", action: "Find why the stop was pressed, make safe, release and reset locally" };

const vesselAlarms = (): AlarmTemplate[] => [
  { role: "level", on: "hihi", priority: "high", message: "{label} level critically high", consequence: "Overflow or carry-over to downstream equipment", action: "Stop the inflow, confirm the outlet is running" },
  { role: "level", on: "hi", priority: "medium", message: "{label} level high", consequence: "Approaching overflow", action: "Reduce inflow or increase outflow" },
  { role: "level", on: "lo", priority: "medium", message: "{label} level low", consequence: "Downstream pumps may run dry", action: "Check the supply, prepare to stop the outlet pumps" },
  { role: "high", on: "bit", priority: "high", message: "{label} high level switch", consequence: "Independent high-level protection has tripped", action: "Stop the inflow; investigate why the transmitter did not alarm first" },
];

const PACKML_ALARMS: AlarmTemplate[] = [
  { role: "fault", on: "bit", priority: "medium", message: "{label} stopped on fault", consequence: "Line output lost while the machine is down", action: "Read the machine's first-out fault, clear it, reset and restart from the HMI" },
  { role: "estop", on: "bit", priority: "high", message: "{label} emergency stop", consequence: "Machine aborted by an emergency stop", action: "Make safe, release the stop, clear and reset" },
];

/* ---------------------------------------------------------------- classes */

export const MACHINE_CLASSES: readonly MachineClass[] = [
  // --- rotating equipment -------------------------------------------------
  {
    id: "pump", name: "Pump (fixed speed)", industries: ["water", "process", "utilities", "food-bev"], level: "equipment-module",
    prefixes: ["PMP", "PUMP", "P", "PU"], typeWords: ["pump", "pmp"], commentWords: ["pump"],
    symbol: "Pumps/Pump01",
    roles: [R.running, R.fault, R.available, R.auto, R.start, R.stop, R.reset, R.current, R.hours, R.flow, R.pressure, R.estop],
    headline: ["flow", "pressure", "current", "hours"], trends: ["flow", "pressure", "current"],
    alarms: [...motorAlarms("Pump"), ESTOP_ALARM],
    description: "Direct-on-line or soft-started pump: run/fault/available feedback, start/stop commands, optional discharge flow and pressure.",
  },
  {
    id: "vsd-pump", name: "Pump (variable speed)", industries: ["water", "process", "utilities", "hvac"], level: "equipment-module",
    prefixes: ["VSP", "VFDP"], typeWords: ["vsdpump", "vfdpump", "pumpvsd", "pump_vsd", "pumpvfd"], commentWords: ["vsd", "vfd", "variable speed", "inverter"],
    symbol: "Pumps/Pump01",
    roles: [R.running, R.fault, R.available, R.auto, R.start, R.stop, R.reset, role(R.speed, { expected: true }), R.speedSp, R.current, R.power, R.hours, R.flow, R.pressure],
    headline: ["flow", "speed", "pressure", "current"], trends: ["speed", "flow", "pressure"],
    alarms: motorAlarms("Pump"),
    description: "Pump on a drive: as a fixed-speed pump plus speed feedback and a speed reference the operator or a loop sets.",
  },
  {
    id: "doser", name: "Dosing pump", industries: ["water", "process", "food-bev"], level: "equipment-module",
    prefixes: ["DOS", "DOSE", "DP"], typeWords: ["dosing", "doser", "metering"], commentWords: ["dosing", "dose", "metering", "chemical"],
    symbol: "Pumps/Pump02",
    roles: [R.running, R.fault, R.auto, R.start, R.stop, role(R.speed, { spellings: ["STROKE", "STROKES"] }), R.speedSp, R.flow, R.total, role(R.levelLo, { spellings: ["TANKLOW", "CHEMLOW"] })],
    headline: ["flow", "speed"], trends: ["flow"],
    alarms: [...motorAlarms("Dosing"), { role: "low", on: "bit", priority: "medium", message: "{label} chemical tank low", consequence: "Dosing will stop when the day tank empties", action: "Arrange a chemical delivery or changeover" }],
    description: "Metering pump with stroke rate or speed control and dosed totaliser.",
  },
  {
    id: "motor", name: "Motor (direct on line)", industries: ["discrete", "process", "material-handling"], level: "control-module",
    prefixes: ["MTR", "MOT", "M", "MOTOR"], typeWords: ["motor", "mtr", "dol"], commentWords: ["motor"],
    symbol: "General/Motor01",
    roles: [R.running, R.fault, R.available, R.auto, R.start, R.stop, R.reset, R.current, R.hours, R.starts],
    headline: ["current", "hours"], trends: ["current"],
    alarms: motorAlarms("Motor"),
    description: "Contactor-started motor with overload trip.",
  },
  {
    id: "drive", name: "Variable speed drive", industries: ["discrete", "process", "hvac", "material-handling"], level: "control-module",
    prefixes: ["VSD", "VFD", "INV", "DRV", "ATV"], typeWords: ["drive", "vsd", "vfd", "atv", "inverter"], commentWords: ["drive", "inverter", "vsd", "vfd"],
    symbol: "General/Inverter",
    roles: [R.running, R.fault, R.available, R.start, R.stop, R.reset, role(R.speed, { expected: true }), R.speedSp, R.current, R.power, role(R.temperature, { spellings: ["HEATSINK"] })],
    headline: ["speed", "current", "power"], trends: ["speed", "current"],
    alarms: [{ role: "fault", on: "bit", priority: "high", message: "{label} drive trip", consequence: "Motor stopped by the drive", action: "Read the drive's fault code at the keypad or over the network, correct, reset" }],
    description: "An Altivar-type drive: run/fault, speed reference and feedback, motor current and power.",
  },
  {
    id: "fan", name: "Fan / blower", industries: ["hvac", "process", "utilities"], level: "equipment-module",
    prefixes: ["FAN", "BLW", "BLOWER", "EF", "SF"], typeWords: ["fan", "blower"], commentWords: ["fan", "blower", "extract", "supply air"],
    symbol: "Fans/Fan01",
    roles: [R.running, R.fault, R.auto, R.start, R.stop, R.speed, R.speedSp, R.current, R.dp, R.vibration],
    headline: ["speed", "pressure", "current"], trends: ["speed", "pressure"],
    alarms: [...motorAlarms("Fan"), { role: "vibration", on: "hi", priority: "medium", message: "{label} vibration high", consequence: "Bearing or impeller damage developing", action: "Plan an inspection; stop if it continues to rise" }],
    description: "Supply, extract or process fan, often on a drive, with airflow proved by differential pressure.",
  },
  {
    id: "compressor", name: "Air compressor", industries: ["utilities", "process", "discrete"], level: "unit",
    prefixes: ["CMP", "COMP", "AC", "CP"], typeWords: ["compressor"], commentWords: ["compressor", "compressed air"],
    symbol: "Air Compressors/AirCompressor01",
    roles: [R.running, R.fault, R.available, R.start, R.stop, R.reset, role(R.pressure, { expected: true }), R.temperature, R.current, R.hours, { role: "loaded", kind: "status", spellings: ["LOAD", "LOADED", "UNLOAD"] }],
    headline: ["pressure", "temperature", "current"], trends: ["pressure", "temperature"],
    alarms: [...motorAlarms("Compressor"), { role: "pressure", on: "lo", priority: "medium", message: "{label} header pressure low", consequence: "Pneumatic actuators slow or fail to stroke", action: "Start the standby compressor, check for leaks" }, { role: "temperature", on: "hi", priority: "high", message: "{label} discharge temperature high", consequence: "Compressor will trip on protection; oil degradation", action: "Check cooling, reduce load" }],
    description: "Screw or piston compressor with loaded/unloaded state and header pressure.",
  },
  // --- valves --------------------------------------------------------------
  {
    id: "valve", name: "On/off valve", industries: ["water", "process", "food-bev", "utilities"], level: "control-module",
    prefixes: ["VLV", "VAL", "XV", "SV", "V", "MOV", "HV"], typeWords: ["valve", "vlv", "onoff"], commentWords: ["valve", "isolat", "solenoid"],
    symbol: "Valves/Valve01",
    roles: [R.open, R.closed, R.openCmd, R.auto, R.fault],
    headline: ["open", "closed"], trends: [],
    alarms: [{ role: "fault", on: "bit", priority: "medium", message: "{label} failed to move", consequence: "The flow path is not in the state the sequence expects", action: "Check air supply and the limit switches; operate locally to confirm" }],
    description: "Two-position valve with open and closed limit switches; a discrepancy timer raises failed-to-move.",
  },
  {
    id: "control-valve", name: "Control valve", industries: ["process", "water", "hvac", "utilities"], level: "control-module",
    prefixes: ["FCV", "PCV", "LCV", "TCV", "CV"], typeWords: ["controlvalve", "cv", "modulating"], commentWords: ["control valve", "modulating"],
    symbol: "Valves/Valve02",
    roles: [role(R.position, { expected: true }), role(R.positionSp, { expected: true }), R.auto, R.fault],
    headline: ["position"], trends: ["position"],
    alarms: [{ role: "position", on: "hi", priority: "low", message: "{label} position deviation", consequence: "Valve not following its demand; loop control degraded", action: "Check the positioner and air supply" }],
    description: "Modulating valve: demand from a loop or the operator, position feedback.",
  },
  {
    id: "damper", name: "Damper", industries: ["hvac"], level: "control-module",
    prefixes: ["DMP", "DAMPER", "DA"], typeWords: ["damper"], commentWords: ["damper", "louvre", "louver"],
    symbol: "General/Louver01",
    roles: [R.open, R.closed, R.position, R.positionSp, R.fault],
    headline: ["position"], trends: [],
    alarms: [],
    description: "Air damper, two-position or modulating.",
  },
  // --- vessels -------------------------------------------------------------
  {
    id: "tank", name: "Tank", industries: ["water", "process", "food-bev", "utilities"], level: "unit",
    prefixes: ["TNK", "TK", "T", "TANK", "SUMP", "WELL"], typeWords: ["tank", "vessel", "sump"], commentWords: ["tank", "vessel", "sump", "reservoir", "well"],
    symbol: "Tanks/Tank01",
    roles: [R.level, R.levelHi, R.levelLo, { role: "volume", kind: "measure", spellings: ["VOL", "VOLUME"], unit: "m³" }, R.temperature, R.pressure],
    headline: ["level", "volume", "temperature"], trends: ["level"],
    alarms: vesselAlarms(),
    description: "Storage or buffer vessel with continuous level and independent level switches.",
  },
  {
    id: "silo", name: "Silo / hopper", industries: ["process", "food-bev", "material-handling"], level: "unit",
    prefixes: ["SILO", "HOP", "HOPPER", "BIN"], typeWords: ["silo", "hopper", "bin"], commentWords: ["silo", "hopper", "bin"],
    symbol: "Tanks/Tank03",
    roles: [R.level, R.levelHi, R.levelLo, R.weight, { role: "running", kind: "status", spellings: ["VIBRATOR", "AERATION"] }],
    headline: ["level", "weight"], trends: ["level"],
    alarms: vesselAlarms().filter((a) => a.on !== "lo"),
    description: "Bulk-solids store: level by radar or weight by load cells.",
  },
  {
    id: "mixer", name: "Mixer / agitator", industries: ["process", "food-bev"], level: "equipment-module",
    prefixes: ["MIX", "AGT", "AGIT", "MX", "STR"], typeWords: ["mixer", "agitator", "stirrer"], commentWords: ["mixer", "agitator", "stirrer", "blend"],
    symbol: "Mixing/Mixing01",
    roles: [R.running, R.fault, R.start, R.stop, R.speed, R.speedSp, R.current],
    headline: ["speed", "current"], trends: ["speed", "current"],
    alarms: motorAlarms("Agitator"),
    description: "Tank agitator; must not run below a minimum level, which the interlock and the faceplate should show.",
  },
  {
    id: "reactor", name: "Reactor", industries: ["process"], level: "unit",
    prefixes: ["RCT", "REA", "R", "RX"], typeWords: ["reactor"], commentWords: ["reactor", "batch"],
    symbol: "Mixing/Mixing05",
    roles: [R.level, role(R.temperature, { expected: true }), R.temperatureSp, R.pressure, R.step, R.levelHi],
    headline: ["temperature", "pressure", "level"], trends: ["temperature", "pressure", "level"],
    alarms: [
      { role: "temperature", on: "hihi", priority: "high", message: "{label} temperature critically high", consequence: "Runaway reaction risk", action: "Apply full cooling, stop feeds, follow the emergency procedure" },
      { role: "temperature", on: "hi", priority: "medium", message: "{label} temperature high", consequence: "Product off-spec; approaching runaway margin", action: "Increase cooling, reduce feed rate" },
      { role: "pressure", on: "hi", priority: "high", message: "{label} pressure high", consequence: "Relief valve will lift", action: "Vent to the scrubber per procedure, stop heating" },
    ],
    description: "Batch reactor (ISA-88 unit): jacket temperature control, pressure, and a phase/step number.",
  },
  // --- thermal -------------------------------------------------------------
  {
    id: "boiler", name: "Boiler", industries: ["utilities", "process", "food-bev"], level: "unit",
    prefixes: ["BLR", "BOILER", "B"], typeWords: ["boiler", "burner"], commentWords: ["boiler", "burner", "steam"],
    symbol: "General/Heater01",
    roles: [R.running, R.fault, role(R.pressure, { expected: true }), R.temperature, R.level, { role: "flame", kind: "status", spellings: ["FLAME", "FLAMEON", "FLAMEOK"] }, { role: "modulation", kind: "measure", spellings: ["MOD", "MODULATION", "FIRINGRATE"], unit: "%" }, R.start, R.stop, R.reset],
    headline: ["pressure", "temperature", "level"], trends: ["pressure", "temperature", "level"],
    alarms: [
      { role: "fault", on: "bit", priority: "high", message: "{label} lockout", consequence: "Steam production lost", action: "Read the burner controller's lockout code; reset only after the cause is found" },
      { role: "level", on: "lolo", priority: "high", message: "{label} water level critically low", consequence: "Tube damage if firing continues (the low-water cut-out should trip)", action: "Confirm the burner has tripped; check feedwater pumps" },
      { role: "pressure", on: "hi", priority: "medium", message: "{label} steam pressure high", consequence: "Safety valve lift", action: "Check demand and the pressure controller" },
    ],
    description: "Steam or hot-water boiler with burner management; protection is in the burner controller, never in the HMI.",
  },
  {
    id: "heat-exchanger", name: "Heat exchanger", industries: ["process", "hvac", "food-bev", "utilities"], level: "equipment-module",
    prefixes: ["HX", "HEX", "E", "PHE"], typeWords: ["heatexchanger", "hx", "exchanger"], commentWords: ["heat exchanger", "exchanger", "plate heat"],
    symbol: "General/Heater02",
    roles: [role(R.temperature, { spellings: ["TIN", "TOUT", "SUPPLY", "RETURN"] }), R.temperatureSp, R.flow, R.dp],
    headline: ["temperature", "flow"], trends: ["temperature"],
    alarms: [{ role: "pressure", on: "hi", priority: "low", message: "{label} differential pressure high", consequence: "Fouling is reducing duty", action: "Schedule a clean" }],
    description: "Shell-and-tube or plate exchanger: inlet/outlet temperatures and differential pressure for fouling.",
  },
  {
    id: "heater", name: "Heater", industries: ["process", "discrete", "food-bev"], level: "control-module",
    prefixes: ["HTR", "HEATER", "EH"], typeWords: ["heater"], commentWords: ["heater", "heating element", "trace"],
    symbol: "General/Heater01",
    roles: [R.running, R.fault, role(R.temperature, { expected: true }), R.temperatureSp, R.current],
    headline: ["temperature"], trends: ["temperature"],
    alarms: [{ role: "temperature", on: "hi", priority: "high", message: "{label} over-temperature", consequence: "Element or product damage", action: "Confirm the heater has tripped; check the controller" }],
    description: "Electric heater with temperature control.",
  },
  {
    id: "oven", name: "Oven / furnace", industries: ["food-bev", "discrete", "process"], level: "unit",
    prefixes: ["OVN", "OVEN", "FUR", "KILN"], typeWords: ["oven", "furnace", "kiln"], commentWords: ["oven", "furnace", "kiln", "bake", "cure"],
    symbol: "General/Heater02",
    roles: [R.running, R.fault, role(R.temperature, { expected: true }), R.temperatureSp, { role: "zone", kind: "measure", spellings: ["Z1", "Z2", "Z3", "ZONE1", "ZONE2", "ZONE3"], unit: "°C" }, R.speed],
    headline: ["temperature", "speed"], trends: ["temperature"],
    alarms: [{ role: "temperature", on: "hi", priority: "high", message: "{label} over-temperature", consequence: "Product and equipment damage, fire risk", action: "Stop the burner/heaters, keep exhaust running, stop the conveyor feed" }],
    description: "Tunnel or batch oven with zone temperatures and a belt speed.",
  },
  {
    id: "dryer", name: "Dryer", industries: ["process", "food-bev"], level: "unit",
    prefixes: ["DRY", "DRYER", "DR"], typeWords: ["dryer", "drier"], commentWords: ["dryer", "drier", "drying"],
    symbol: "General/Heater02",
    roles: [R.running, R.fault, R.temperature, R.temperatureSp, { role: "humidity", kind: "measure", spellings: ["RH", "HUM", "HUMIDITY", "MOIST", "MOISTURE"], unit: "%" }, R.speed],
    headline: ["temperature", "humidity"], trends: ["temperature", "humidity"],
    alarms: [{ role: "temperature", on: "hi", priority: "high", message: "{label} temperature high", consequence: "Product damage, dust ignition risk", action: "Stop the heat source; keep the fan running" }],
    description: "Convective dryer: inlet/outlet air temperature and moisture.",
  },
  {
    id: "chiller", name: "Chiller", industries: ["hvac", "utilities", "food-bev"], level: "unit",
    prefixes: ["CHL", "CH", "CHILLER"], typeWords: ["chiller"], commentWords: ["chiller", "chilled water"],
    symbol: "Air Conditioners/AirConditioner01",
    roles: [R.running, R.fault, R.start, R.stop, role(R.temperature, { spellings: ["CHWS", "CHWR", "LWT", "EWT"] }), R.temperatureSp, R.current, R.power],
    headline: ["temperature", "power"], trends: ["temperature"],
    alarms: [...motorAlarms("Chiller"), { role: "temperature", on: "hi", priority: "medium", message: "{label} chilled water temperature high", consequence: "Process or space cooling inadequate", action: "Start the standby chiller, check load" }],
    description: "Packaged chiller, normally run through its own controller; the HMI shows status and leaving water temperature.",
  },
  {
    id: "cooling-tower", name: "Cooling tower", industries: ["hvac", "utilities", "process"], level: "unit",
    prefixes: ["CT", "CTW", "TOWER"], typeWords: ["coolingtower", "tower"], commentWords: ["cooling tower", "condenser water"],
    symbol: "General/CoolingTower01",
    roles: [R.running, R.fault, R.speed, R.speedSp, role(R.temperature, { spellings: ["CWS", "CWR"] }), R.level, { role: "conductivity", kind: "measure", spellings: ["COND", "CONDUCTIVITY", "TDS"], unit: "µS/cm" }],
    headline: ["temperature", "speed"], trends: ["temperature"],
    alarms: [{ role: "temperature", on: "hi", priority: "medium", message: "{label} condenser water temperature high", consequence: "Chiller efficiency loss, possible chiller trip", action: "Check fan staging and water treatment" }],
    description: "Evaporative tower: fan speed, basin level, water temperatures, conductivity for blowdown.",
  },
  {
    id: "ahu", name: "Air handling unit", industries: ["hvac"], level: "unit",
    prefixes: ["AHU", "FCU", "MAU", "RTU"], typeWords: ["ahu", "airhandling", "fcu"], commentWords: ["air handling", "ahu", "fan coil", "supply air"],
    symbol: "Air Conditioners/AirConditioner03",
    roles: [R.running, R.fault, role(R.temperature, { spellings: ["SAT", "RAT", "OAT", "MAT", "SUPPLY", "RETURN"] }), R.temperatureSp, { role: "humidity", kind: "measure", spellings: ["RH", "HUM", "HUMIDITY"], unit: "%" }, R.dp, R.position, { role: "co2", kind: "measure", spellings: ["CO2"], unit: "ppm" }],
    headline: ["temperature", "humidity"], trends: ["temperature", "humidity"],
    alarms: [{ role: "pressure", on: "hi", priority: "low", message: "{label} filter dirty", consequence: "Airflow falling, energy rising", action: "Schedule a filter change" }, { role: "fault", on: "bit", priority: "medium", message: "{label} fault", consequence: "Space conditions will drift", action: "Check the supply fan and the frost stat" }],
    description: "Supply/return fans, coils, dampers and filters under one controller.",
  },
  // --- treatment and separation --------------------------------------------
  {
    id: "filter", name: "Filter", industries: ["water", "process", "food-bev"], level: "equipment-module",
    prefixes: ["FIL", "FLTR", "FILTER", "F", "SF", "BW"], typeWords: ["filter"], commentWords: ["filter", "backwash", "strainer"],
    symbol: "General/Filter",
    roles: [R.dp, R.flow, R.step, { role: "backwash", kind: "status", spellings: ["BACKWASH", "BW", "WASH", "CIP"] }, R.fault],
    headline: ["pressure", "flow"], trends: ["pressure", "flow"],
    alarms: [{ role: "pressure", on: "hi", priority: "medium", message: "{label} differential pressure high", consequence: "Filter blinding; throughput falls", action: "Initiate a backwash or change the element" }],
    description: "Media or cartridge filter with differential pressure and a backwash sequence.",
  },
  {
    id: "centrifuge", name: "Centrifuge / decanter", industries: ["process", "food-bev", "water"], level: "unit",
    prefixes: ["CFG", "CEN", "DEC", "SEP"], typeWords: ["centrifuge", "decanter", "separator"], commentWords: ["centrifuge", "decanter", "separator"],
    symbol: "General/Shakingapparatus",
    roles: [R.running, R.fault, R.speed, R.current, R.vibration, role(R.speed, { role: "differential", spellings: ["DIFFSPD", "DIFF", "SCROLL"] }), R.temperature],
    headline: ["speed", "vibration", "current"], trends: ["speed", "vibration"],
    alarms: [{ role: "vibration", on: "hihi", priority: "high", message: "{label} vibration trip", consequence: "Bowl damage risk", action: "Confirm stopped; do not restart before inspection" }, ...motorAlarms("Centrifuge")],
    description: "High-speed separator; vibration protection is mandatory.",
  },
  // --- material handling ---------------------------------------------------
  {
    id: "conveyor", name: "Conveyor", industries: ["material-handling", "packaging", "food-bev", "discrete"], level: "equipment-module",
    prefixes: ["CNV", "CONV", "CV", "BELT", "BC"], typeWords: ["conveyor", "belt"], commentWords: ["conveyor", "belt"],
    symbol: "General/Conveyor01",
    roles: [R.running, R.fault, R.start, R.stop, R.speed, R.speedSp, R.jam, R.estop, { role: "sensor", kind: "status", spellings: ["PE", "PEC", "PHOTOEYE", "PROX", "BLOCKED"] }, { role: "pullcord", kind: "status", spellings: ["PULLCORD", "PULLWIRE", "LANYARD"] }, { role: "misalign", kind: "status", spellings: ["MISALIGN", "DRIFT", "BELTSWAY"] }],
    headline: ["speed"], trends: ["speed"],
    alarms: [...motorAlarms("Conveyor"), ESTOP_ALARM, { role: "pullcord", on: "bit", priority: "high", message: "{label} pull-cord operated", consequence: "Conveyor stopped by a pull-cord", action: "Find the operated switch, make safe, reset locally" }],
    description: "Belt or roller conveyor with zone photo-eyes, pull-cords and belt-alignment switches.",
  },
  {
    id: "crusher", name: "Crusher / mill", industries: ["material-handling", "process"], level: "unit",
    prefixes: ["CRU", "CRUSH", "MILL", "GRD"], typeWords: ["crusher", "mill", "grinder"], commentWords: ["crusher", "mill", "grinder"],
    symbol: "General/Machining",
    roles: [R.running, R.fault, R.current, R.power, R.vibration, role(R.temperature, { spellings: ["BRG", "BEARING"] }), R.speed],
    headline: ["current", "power"], trends: ["current", "power"],
    alarms: [...motorAlarms("Crusher"), { role: "temperature", on: "hi", priority: "medium", message: "{label} bearing temperature high", consequence: "Bearing failure developing", action: "Check lubrication; reduce feed" }],
    description: "Size reduction; motor current is the operator's load indicator.",
  },
  {
    id: "scale", name: "Weigh scale / feeder", industries: ["process", "food-bev", "packaging"], level: "control-module",
    prefixes: ["WT", "WIT", "SCALE", "WGT", "LC"], typeWords: ["scale", "weigh", "loadcell", "feeder"], commentWords: ["scale", "weigh", "load cell", "feeder"],
    symbol: "General/Weighingscale",
    roles: [role(R.weight, { expected: true }), { role: "setpoint", kind: "setpoint", spellings: ["TARGET", "SP"], unit: "kg" }, { role: "stable", kind: "status", spellings: ["STABLE", "MOTIONLESS"] }, R.total, { role: "tare", kind: "command", spellings: ["TARE", "ZERO"] }],
    headline: ["weight"], trends: ["weight"],
    alarms: [],
    description: "Load-cell scale or loss-in-weight feeder.",
  },
  {
    id: "robot", name: "Robot cell", industries: ["discrete", "packaging", "material-handling"], level: "unit",
    prefixes: ["ROB", "RBT", "ROBOT", "R"], typeWords: ["robot", "rbt"], commentWords: ["robot", "pick", "palletis", "palletiz"],
    symbol: "General/Robot01",
    roles: [R.running, R.fault, R.estop, { role: "home", kind: "status", spellings: ["HOME", "ATHOME", "INHOME"] }, { role: "door", kind: "status", spellings: ["DOOR", "GUARD", "GATE", "INTERLOCK"] }, R.start, R.stop, R.reset, role(R.state, { spellings: ["PROGRAM", "PGM"] }), R.produced],
    headline: ["state", "count"], trends: [],
    alarms: [...motorAlarms("Robot"), ESTOP_ALARM, { role: "door", on: "bit", priority: "medium", message: "{label} guard door open", consequence: "Cell stopped by its safety interlock", action: "Close and reset the guard; never bypass" }],
    description: "Robot behind a guarded cell, controlled through its own controller; the HMI shows mode, home and guard status.",
  },
  // --- packaging (PackML) ---------------------------------------------------
  ...(["filler", "capper", "labeler", "case-packer", "palletizer", "wrapper"] as const).map((id): MachineClass => {
    const NAMES: Record<typeof id, [string, string[], string[], string]> = {
      filler: ["Filler", ["FIL", "FILLER", "FLR"], ["fill", "filler"], "General/Bottle01"],
      capper: ["Capper", ["CAP", "CAPPER", "CPR"], ["cap", "capper", "capping"], "General/Bottle02"],
      labeler: ["Labeller", ["LBL", "LAB", "LABELER", "LABELLER"], ["label", "labeler", "labeller"], "General/Label"],
      "case-packer": ["Case packer", ["CPK", "CASE", "PACKER", "CP"], ["case", "packer", "carton"], "General/Box01"],
      palletizer: ["Palletiser", ["PAL", "PLT", "PALLET"], ["pallet", "palletis", "palletiz"], "General/Pallet"],
      wrapper: ["Stretch wrapper", ["WRP", "WRAP", "WRAPPER"], ["wrap", "wrapper", "stretch"], "General/Box02"],
    };
    const [name, prefixes, words, symbol] = NAMES[id];
    return {
      id, name, industries: ["packaging", "food-bev"], level: "unit", prefixes, typeWords: [...words, "packml"], commentWords: words,
      symbol,
      roles: [role(R.state, { expected: true }), R.unitMode, R.cntrlCmd, R.machSpeed, R.produced, R.rejects, R.efficiency, R.fault, R.jam, R.estop, R.running],
      headline: ["state", "speed", "count", "efficiency"], trends: ["speed"],
      alarms: PACKML_ALARMS,
      packml: true,
      description: `${name} following the PackML state model (ISA-TR88.00.02): state, mode, speed and production counters as PackTags.`,
    };
  }),
  // --- discrete manufacturing ------------------------------------------------
  {
    id: "cnc", name: "CNC machine", industries: ["discrete"], level: "unit",
    prefixes: ["CNC", "MC", "LATHE", "MILLING"], typeWords: ["cnc", "lathe", "machiningcenter"], commentWords: ["cnc", "lathe", "spindle", "machining"],
    symbol: "General/Machining",
    roles: [R.running, R.fault, role(R.speed, { spellings: ["SPINDLE", "SPINDLESPEED", "S"] }), { role: "feed", kind: "measure", spellings: ["FEED", "FEEDRATE", "F"], unit: "mm/min" }, { role: "override", kind: "setpoint", spellings: ["OVR", "OVERRIDE", "FOVR"], unit: "%" }, role(R.state, { spellings: ["PROGRAM", "PGM", "CYCLE"] }), R.produced, R.estop, { role: "door", kind: "status", spellings: ["DOOR", "GUARD"] }, { role: "tool", kind: "state", spellings: ["TOOL", "TOOLNO"] }],
    headline: ["state", "speed", "count"], trends: ["speed"],
    alarms: [...motorAlarms("Machine"), ESTOP_ALARM],
    description: "Machine tool on its own NC; the HMI is a cell overview of cycle state, spindle, feed override and counts.",
  },
  {
    id: "injection-molding", name: "Injection moulding machine", industries: ["discrete"], level: "unit",
    prefixes: ["IMM", "INJ", "MOLD", "MOULD"], typeWords: ["injection", "imm", "molding", "moulding"], commentWords: ["injection", "mould", "mold", "barrel"],
    symbol: "General/Extrude03",
    roles: [R.running, R.fault, role(R.temperature, { spellings: ["BARREL", "NOZZLE", "ZONE"] }), R.temperatureSp, role(R.pressure, { spellings: ["INJ", "HOLD", "BACK"] }), { role: "cycle", kind: "measure", spellings: ["CYCLETIME", "CYCLE", "CT"], unit: "s" }, R.produced, R.rejects, R.state],
    headline: ["state", "temperature", "count"], trends: ["temperature", "pressure"],
    alarms: [{ role: "temperature", on: "hi", priority: "medium", message: "{label} barrel temperature high", consequence: "Material degradation", action: "Check the zone heater controller" }],
    description: "Cycle-driven machine: barrel zones, injection pressure, cycle time and shot counts.",
  },
  {
    id: "extruder", name: "Extruder", industries: ["discrete", "process", "food-bev"], level: "unit",
    prefixes: ["EXT", "EXTR", "EX"], typeWords: ["extruder", "extrusion"], commentWords: ["extruder", "extrusion", "screw", "die"],
    symbol: "General/Extrude01",
    roles: [R.running, R.fault, role(R.speed, { spellings: ["SCREW", "SCREWSPEED"] }), R.speedSp, role(R.temperature, { spellings: ["ZONE", "DIE", "BARREL", "MELT"] }), role(R.pressure, { spellings: ["MELT", "DIE"] }), R.current],
    headline: ["speed", "temperature", "pressure"], trends: ["temperature", "pressure"],
    alarms: [{ role: "pressure", on: "hihi", priority: "high", message: "{label} melt pressure critically high", consequence: "Die or barrel rupture risk", action: "Stop the screw immediately" }],
    description: "Screw extruder: zone temperatures, melt pressure, screw speed and load.",
  },
  // --- power -------------------------------------------------------------------
  {
    id: "generator", name: "Generator set", industries: ["power", "utilities"], level: "unit",
    prefixes: ["GEN", "GENSET", "DG", "G"], typeWords: ["generator", "genset"], commentWords: ["generator", "genset", "diesel"],
    symbol: "General/Power01",
    roles: [R.running, R.fault, R.start, R.stop, { role: "voltage", kind: "measure", spellings: ["V", "VOLT", "VOLTAGE", "VL1", "VLL"], unit: "V" }, role(R.speed, { role: "frequency", spellings: ["FREQ", "HZ", "F"], unit: "Hz" }), R.power, R.current, { role: "fuel", kind: "measure", spellings: ["FUEL", "FUELLVL"], unit: "%" }, { role: "breaker", kind: "status", spellings: ["CB", "BREAKER", "ONLOAD", "GCB"] }],
    headline: ["power", "voltage", "frequency"], trends: ["power"],
    alarms: [{ role: "fault", on: "bit", priority: "high", message: "{label} shutdown", consequence: "Standby power lost", action: "Read the genset controller's alarm, correct, reset" }, { role: "fuel", on: "lo", priority: "medium", message: "{label} fuel low", consequence: "Run time limited", action: "Arrange refuelling" }],
    description: "Diesel or gas genset under its own controller.",
  },
  {
    id: "feeder", name: "Electrical feeder / breaker", industries: ["power", "utilities", "discrete"], level: "control-module",
    prefixes: ["MCC", "FDR", "CB", "QF", "PM", "MTR_PM"], typeWords: ["breaker", "feeder", "powermeter", "pm"], commentWords: ["breaker", "feeder", "incomer", "power meter", "mcc"],
    symbol: "General/Lightning01",
    roles: [{ role: "closed", kind: "status", spellings: ["CLOSED", "ON", "CB_CLOSED"] }, { role: "tripped", kind: "status", spellings: ["TRIP", "TRIPPED"] }, { role: "voltage", kind: "measure", spellings: ["V", "VOLT", "VOLTAGE", "VLL", "VLN"], unit: "V" }, R.current, R.power, { role: "energy", kind: "count", spellings: ["KWH", "ENERGY", "E"], unit: "kWh" }, { role: "factor", kind: "measure", spellings: ["PF", "COSPHI"] }],
    headline: ["power", "current", "voltage"], trends: ["power"],
    alarms: [{ role: "tripped", on: "bit", priority: "high", message: "{label} breaker tripped", consequence: "Loads on this feeder have lost supply", action: "Investigate the protection relay before reclosing" }],
    description: "A breaker and its power meter (PowerLogic-type): state, V, I, kW, kWh, PF.",
  },
  // --- control loops and instruments --------------------------------------------
  {
    id: "pid", name: "PID loop", industries: ["process", "water", "hvac", "utilities", "food-bev"], level: "control-module",
    prefixes: ["PID", "FIC", "LIC", "PIC", "TIC", "AIC", "LOOP"], typeWords: ["pid", "loop", "controller"], commentWords: ["controller", "control loop", "pid"],
    roles: [role(R.pv, { expected: true }), role(R.sp, { expected: true }), role(R.out, { expected: true }), R.pidMode],
    headline: ["value", "setpoint", "output"], trends: ["value", "setpoint", "output"],
    alarms: [{ role: "value", on: "hi", priority: "low", message: "{label} deviation from setpoint", consequence: "Control loop not holding its setpoint", action: "Check the final element; consider manual" }],
    description: "A control loop: PV, SP, output and mode. The faceplate is the standard loop faceplate.",
  },
  {
    id: "analyser", name: "Analyser", industries: ["water", "process", "food-bev"], level: "control-module",
    prefixes: ["AT", "AIT", "QT", "PH", "ORP", "TURB", "CL", "DO", "COND"], typeWords: ["analyser", "analyzer", "ph", "turbidity", "chlorine"], commentWords: ["ph", "turbidity", "chlorine", "conductivity", "oxygen", "orp", "analyser", "analyzer"],
    symbol: "General/Sensor01",
    roles: [role(R.pv, { spellings: ["PH", "NTU", "PPM", "MGL", "ORP", "COND"] }), { role: "fault", kind: "status", spellings: ["FLT", "FAULT", "CAL", "MAINT"] }],
    headline: ["value"], trends: ["value"],
    alarms: [{ role: "value", on: "hi", priority: "medium", message: "{label} high", consequence: "Water/product quality out of limit", action: "Check the dosing and sample a grab for confirmation" }, { role: "value", on: "lo", priority: "medium", message: "{label} low", consequence: "Water/product quality out of limit", action: "Check the dosing and sample a grab for confirmation" }],
    description: "Quality analyser: pH, ORP, chlorine, turbidity, conductivity, dissolved oxygen.",
  },
];

/* --------------------------------------------------------------- lookups */

const byId = new Map(MACHINE_CLASSES.map((c) => [c.id, c]));
export const machineClass = (id: string): MachineClass | undefined => byId.get(id);

/** Words of a tag or member name, upper case, numbers dropped. */
export function words(name: string): string[] {
  return name
    .split(/[_.\-\s]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/)
    .filter((w) => w && !/^\d+$/.test(w))
    .map((w) => w.toUpperCase());
}

/** The role a tag or member name plays in a class, by its last word, or null. */
export function roleIn(klass: MachineClass, name: string): RoleSpec | null {
  const w = words(name);
  if (w.length === 0) return null;
  const last = w[w.length - 1];
  const joined = w.slice(-2).join("");
  return klass.roles.find((r) => r.spellings.includes(joined)) ?? klass.roles.find((r) => r.spellings.includes(last)) ?? null;
}

export interface Classification {
  classId: string;
  /** 0..1. Above 0.75 the generator may act on it alone; below, it is a proposal. */
  confidence: number;
  /** Why, in the order the evidence was weighed. */
  evidence: string[];
}

/**
 * Which class a group of signals belongs to, with how sure and why.
 *
 * Evidence, strongest first: a DDT or function-block type name that names a
 * class (the PLC engineer declared it); the tag prefix (a naming convention);
 * how many of the group's signals are roles the class has (the shape fits);
 * words in the comments. Returns every class that scored, best first, so a
 * caller can show the runner-up when the top answer is weak.
 */
export function classify(input: { name: string; typeName?: string; members: string[]; comments?: string[] }): Classification[] {
  const prefix = words(input.name)[0] ?? "";
  const type = (input.typeName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = (input.comments ?? []).join(" ").toLowerCase();
  const out: Classification[] = [];
  for (const c of MACHINE_CLASSES) {
    const evidence: string[] = [];
    let score = 0;
    if (type && c.typeWords.some((w) => type.includes(w.replace(/[^a-z0-9]/g, "")))) {
      score += 0.55;
      evidence.push(`type ${input.typeName} names a ${c.name.toLowerCase()}`);
    }
    if (prefix && c.prefixes.includes(prefix)) {
      // A one-letter prefix (P, T, V) is a weak convention on its own.
      const w = prefix.length === 1 ? 0.15 : 0.35;
      score += w;
      evidence.push(`prefix ${prefix}`);
    }
    if (input.members.length) {
      const hits = input.members.filter((m) => roleIn(c, m)).length;
      const share = hits / input.members.length;
      if (hits > 0) {
        score += 0.3 * share;
        evidence.push(`${hits} of ${input.members.length} signals are ${c.name.toLowerCase()} roles`);
      }
      const expected = c.roles.filter((r) => r.expected);
      const present = expected.filter((r) => input.members.some((m) => roleIn(c, m) === r)).length;
      if (expected.length && present === expected.length) {
        score += 0.1;
        evidence.push("every expected role is present");
      }
    }
    const said = c.commentWords.filter((w) => text.includes(w));
    if (said.length) {
      score += 0.15;
      evidence.push(`comments say "${said[0]}"`);
    }
    if (score > 0) out.push({ classId: c.id, confidence: Math.min(1, Math.round(score * 100) / 100), evidence });
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.classId.localeCompare(b.classId));
}

/** An alarm template's priority as OTE severity 1..9, mid-band per priority. */
export const severityOf = (p: Priority): number => (p === "high" ? 7 : p === "medium" ? 5 : 3);
