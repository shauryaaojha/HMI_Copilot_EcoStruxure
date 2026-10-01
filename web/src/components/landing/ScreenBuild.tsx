"use client";

/**
 * The hero: a screen building itself.
 *
 * Not a stock illustration and not a gradient. This is the shape the generator
 * actually produces - the frame from `lib/ote/layout.ts` (header, navigation
 * strip, alarm band), equipment symbols with their running and fault
 * indicators, pipes drawn between them in flow order, and an analogue
 * indicator per reading - drawn in the ISA-101 pack's own colours.
 *
 * The colours are the resolved hex of the pack's tokens on colour set 4
 * (`lib/standard/pack.ts`): a grey ground, panels one step lighter, equipment
 * in outline, and saturated colour kept for the alarm band. Hard-coded here
 * because this is a picture of a screen rather than a screen - the canvas
 * resolves them properly through the palette.
 *
 * Objects land in the order the build timeline lands them, which is the point:
 * the claim on this page is "watch every object being generated", and the
 * first thing a visitor sees is that happening.
 */

const T = {
  ground: "#d9d9d9",
  panel: "#f1f1f1",
  line: "#515151",
  ink: "#030303",
  muted: "#474747",
  white: "#ffffff",
  running: "#303030",
  alarmP1: "#971a24",
  alarmP2: "#cf7c00",
};

/** One staggered step, so the order reads as a sequence rather than a flash. */
const at = (ms: number) => ({ "--place-delay": `${ms}ms` }) as React.CSSProperties;
const draw = (ms: number, len: number) =>
  ({ "--draw-delay": `${ms}ms`, "--len": len }) as React.CSSProperties;

function Pump({ x, y, label, delay, fault }: { x: number; y: number; label: string; delay: number; fault?: boolean }) {
  return (
    <g>
      <g className="place" style={at(delay)}>
        <circle cx={x + 34} cy={y + 30} r={26} fill={T.panel} stroke={T.line} strokeWidth={2} />
        <path d={`M ${x + 26} ${y + 16} L ${x + 50} ${y + 30} L ${x + 26} ${y + 44} Z`} fill={T.panel} stroke={T.line} strokeWidth={2} />
      </g>
      <circle
        className="place pulse-soft"
        style={{ ...at(delay + 120), "--pulse-delay": `${delay + 900}ms` } as React.CSSProperties}
        cx={x + 60}
        cy={y + 8}
        r={6}
        fill={fault ? T.alarmP1 : T.running}
        stroke={T.line}
      />
      <text className="place" style={at(delay + 160)} x={x + 34} y={y + 74} textAnchor="middle" fontSize={11} fontWeight={600} fill={T.ink}>
        {label}
      </text>
    </g>
  );
}

function Indicator({ x, y, label, value, unit, fill, delay }: { x: number; y: number; label: string; value: string; unit: string; fill: number; delay: number }) {
  return (
    <g className="place" style={at(delay)}>
      <rect x={x} y={y} width={176} height={62} rx={2} fill={T.panel} stroke={T.line} strokeWidth={1} />
      <text x={x + 8} y={y + 17} fontSize={11} fontWeight={600} fill={T.ink}>
        {label}
      </text>
      <text x={x + 168} y={y + 17} textAnchor="end" fontSize={13} fontWeight={700} fill={T.ink} fontFamily="monospace">
        {value}
        <tspan fontSize={10} fontWeight={400} fill={T.muted}>
          {" "}
          {unit}
        </tspan>
      </text>
      {/* scale, normal band, and the bar that reads against them */}
      <rect x={x + 8} y={y + 36} width={160} height={14} fill={T.ground} stroke={T.line} strokeWidth={0.75} />
      <rect x={x + 8 + 160 * 0.2} y={y + 33} width={160 * 0.7} height={4} fill={T.running} opacity={0.35} />
      <rect
        className="draw"
        style={draw(delay + 240, 160)}
        x={x + 8}
        y={y + 36}
        width={160 * fill}
        height={14}
        fill={T.running}
        opacity={0.55}
      />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={x + 8 + 160 * f} y1={y + 50} x2={x + 8 + 160 * f} y2={y + 55} stroke={T.line} strokeWidth={0.75} />
      ))}
    </g>
  );
}

export function ScreenBuild() {
  return (
    <svg viewBox="0 0 1024 600" className="h-auto w-full" role="img" aria-label="A generated operator screen assembling itself: header, navigation, pumps, a tank, pipes, readings and an alarm band.">
      <title>A generated operator screen</title>

      {/* the ground */}
      <rect className="place" style={at(0)} width={1024} height={600} fill={T.ground} />

      {/* header */}
      <g className="place" style={at(90)}>
        <rect width={1024} height={44} fill={T.panel} />
        <line x1={0} y1={44} x2={1024} y2={44} stroke={T.line} strokeWidth={1} />
        <text x={16} y={28} fontSize={15} fontWeight={700} fill={T.ink}>
          Transfer Pump Station
        </text>
        <text x={1008} y={28} textAnchor="end" fontSize={11} fill={T.muted} fontFamily="monospace">
          L2 · PROCESS
        </text>
      </g>

      {/* navigation strip */}
      <g className="place" style={at(160)}>
        <rect y={44} width={1024} height={32} fill={T.ground} />
        <line x1={0} y1={76} x2={1024} y2={76} stroke={T.line} strokeWidth={1} />
        {["Overview", "Pumps", "Tanks", "Alarms"].map((n, i) => (
          <g key={n}>
            <rect x={12 + i * 96} y={50} width={88} height={20} rx={2} fill={i === 1 ? T.panel : "none"} stroke={T.line} strokeWidth={i === 1 ? 1 : 0} />
            <text x={56 + i * 96} y={64} textAnchor="middle" fontSize={11} fill={i === 1 ? T.ink : T.muted}>
              {n}
            </text>
          </g>
        ))}
      </g>

      {/* pipes, drawn in flow order before the equipment settles on them */}
      <g fill="none" stroke={T.line} strokeWidth={3} strokeLinecap="square">
        <path className="draw" style={draw(300, 150)} d="M 150 170 H 300" />
        <path className="draw" style={draw(380, 180)} d="M 300 170 V 300 H 420" />
        <path className="draw" style={draw(460, 220)} d="M 490 170 H 700 V 300" />
        <path className="draw" style={draw(540, 200)} d="M 490 300 H 700" />
      </g>

      {/* equipment, left to right, the way material moves */}
      <g className="place" style={at(230)}>
        <rect x={60} y={132} width={90} height={76} rx={2} fill={T.panel} stroke={T.line} strokeWidth={2} />
        <rect x={60} y={176} width={90} height={32} fill={T.running} opacity={0.18} />
        <text x={105} y={226} textAnchor="middle" fontSize={11} fontWeight={600} fill={T.ink}>
          TNK-101
        </text>
      </g>

      <Pump x={420} y={140} label="PMP-101" delay={620} />
      <Pump x={420} y={270} label="PMP-102" delay={700} fault />

      <g className="place" style={at(780)}>
        <rect x={668} y={262} width={64} height={76} rx={2} fill={T.panel} stroke={T.line} strokeWidth={2} />
        <path d="M 684 338 L 700 300 L 716 338 Z" fill={T.panel} stroke={T.line} strokeWidth={2} />
        <text x={700} y={356} textAnchor="middle" fontSize={11} fontWeight={600} fill={T.ink}>
          FT-101
        </text>
      </g>

      {/* readings */}
      <Indicator x={60} y={400} label="Break tank level" value="62.4" unit="%" fill={0.62} delay={880} />
      <Indicator x={256} y={400} label="Discharge flow" value="148.0" unit="LPM" fill={0.48} delay={950} />
      <Indicator x={452} y={400} label="Pump 101 hours" value="2 184" unit="h" fill={0.3} delay={1020} />

      {/* alarm band - the only saturated colour on the screen */}
      <g className="place" style={at(1120)}>
        <rect y={492} width={1024} height={76} fill={T.panel} stroke={T.line} strokeWidth={1} />
        <text x={16} y={512} fontSize={10} fontWeight={700} fill={T.muted} letterSpacing={1}>
          ACTIVE ALARMS
        </text>
        <rect x={16} y={520} width={992} height={18} fill={T.alarmP1} />
        <text x={24} y={533} fontSize={10} fill={T.white} fontFamily="monospace">
          1  PMP-102  MOTOR FAULT                               14:22:07   UNACK
        </text>
        <rect x={16} y={542} width={992} height={18} fill={T.alarmP2} />
        <text x={24} y={555} fontSize={10} fill={T.ink} fontFamily="monospace">
          2  TNK-101  LEVEL HIGH                                14:19:51   ACK
        </text>
      </g>

      {/* footer */}
      <g className="place" style={at(1200)}>
        <line x1={0} y1={568} x2={1024} y2={568} stroke={T.line} strokeWidth={1} />
        <text x={16} y={586} fontSize={10} fill={T.muted} fontFamily="monospace">
          HMIST6500 · 1024 × 600 · ISA-101
        </text>
        <text x={1008} y={586} textAnchor="end" fontSize={10} fill={T.muted} fontFamily="monospace">
          20 tags · 4 screens · 0 violations
        </text>
      </g>
    </svg>
  );
}
