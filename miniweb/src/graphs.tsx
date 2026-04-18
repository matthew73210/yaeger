import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useMemo, useRef, useState } from "preact/hooks";
import { Profile, RoastState } from "./model";

export type RoastGraphMode = "combined" | "separate";

type EventMarker = { label: string; sec: number };

type GraphSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
};

type VisxLineGraphProps = {
  title: string;
  samples: number[];
  series: GraphSeries[];
  minY: number;
  maxY: number;
  height: number;
  eventTimes?: EventMarker[];
};

const WIDTH = 900;
const MARGIN = { top: 20, right: 20, bottom: 34, left: 52 };

function buildRoR(values: number[], timeSeconds: number[], windowSize = 20): Array<number | null> {
  const rate = values.map((temp, i) => {
    if (i === 0) return null;
    const deltaT = temp - values[i - 1];
    const deltaS = timeSeconds[i] - timeSeconds[i - 1];
    const value = deltaS > 0 ? (deltaT / deltaS) * 60 : null;
    return value != null && Number.isFinite(value) ? value : null;
  });

  return rate.map((value, i, arr) => {
    if (value == null || i < windowSize - 1) return value;
    const window = arr
      .slice(i - windowSize + 1, i + 1)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!window.length) return null;
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });
}

function gridTicks(minY: number, maxY: number, count = 5) {
  const step = (maxY - minY) / count;
  return Array.from({ length: count + 1 }, (_, i) => minY + i * step);
}

function interpolateProfileValue(
  start: number,
  end: number,
  progress: number,
  type: "linear" | "ease-in" | "ease-out" | "ease-in-out",
): number {
  switch (type) {
    case "linear":
      return start + (end - start) * progress;
    case "ease-in":
      return start + (end - start) * Math.pow(progress, 2);
    case "ease-out":
      return start + (end - start) * (1 - Math.pow(1 - progress, 2));
    case "ease-in-out":
      return (
        start +
        (end - start) *
          (progress < 0.5
            ? 2 * Math.pow(progress, 2)
            : 1 - Math.pow(-2 * progress + 2, 2) / 2)
      );
    default:
      return end;
  }
}

function getProfileSetpointAtElapsed(profile: Profile, elapsedSeconds: number): number | null {
  if (!profile.steps.length) return null;
  let accumulated = 0;

  for (let i = 0; i < profile.steps.length; i += 1) {
    const step = profile.steps[i];
    const stepStart = accumulated;
    accumulated += step.duration;
    if (elapsedSeconds <= accumulated) {
      const progress = step.duration > 0 ? (elapsedSeconds - stepStart) / step.duration : 1;
      const previousSetpoint = i === 0 ? step.setpoint : profile.steps[i - 1].setpoint;
      return interpolateProfileValue(previousSetpoint, step.setpoint, progress, step.interpolation);
    }
  }

  return profile.steps[profile.steps.length - 1].setpoint;
}

function buildProfilePreviewGraph(profile: Profile, heightScale: number) {
  const totalDuration = profile.steps.reduce((sum, step) => sum + Math.max(step.duration, 0), 0);
  const previewEndSec = Math.max(1, Math.ceil(totalDuration));
  const previewSamples = Array.from({ length: previewEndSec + 1 }, (_, i) => i);
  const previewValues = previewSamples.map((seconds) => getProfileSetpointAtElapsed(profile, seconds));
  const validValues = previewValues.filter((value): value is number => typeof value === "number");
  const minY = validValues.length ? Math.max(0, Math.floor(Math.min(...validValues) - 5)) : 0;
  const maxY = validValues.length ? Math.ceil(Math.max(...validValues) + 5) : 300;
  return (
    <VisxLineGraph
      title="Profile Preview"
      samples={previewSamples}
      minY={minY}
      maxY={Math.max(maxY, minY + 10)}
      height={Math.round(280 * Math.min(1.8, Math.max(0.7, heightScale)))}
      series={[{ label: "Profile", color: "#facc15", values: previewValues }]}
    />
  );
}

function VisxLineGraph({ title, samples, series, minY, maxY, height, eventTimes = [] }: VisxLineGraphProps) {
  if (samples.length < 2) {
    return <div class="graph-empty">{title}: waiting for samples…</div>;
  }

  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = scaleLinear<number>({
    domain: [0, Math.max(1, samples[samples.length - 1])],
    range: [0, innerWidth],
  });

  const yScale = scaleLinear<number>({
    domain: [minY, maxY],
    range: [innerHeight, 0],
  });

  return (
    <div class="graph-card">
      <h4>{title}</h4>
      <svg class="line-graph" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none">
        <rect x={0} y={0} width={WIDTH} height={height} fill="#0f172a" rx={8} />
        <Group top={MARGIN.top} left={MARGIN.left}>
          {gridTicks(minY, maxY, 5).map((tick) => (
            <line
              key={`${title}-h-${tick}`}
              x1={0}
              y1={yScale(tick)}
              x2={innerWidth}
              y2={yScale(tick)}
              stroke="rgba(148, 163, 184, 0.22)"
              strokeWidth={1}
            />
          ))}

          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const x = innerWidth * ratio;
            return (
              <line
                key={`${title}-v-${ratio}`}
                x1={x}
                y1={0}
                x2={x}
                y2={innerHeight}
                stroke="rgba(148, 163, 184, 0.14)"
                strokeWidth={1}
              />
            );
          })}

          {eventTimes.map((event) => {
            const x = xScale(event.sec);
            return (
              <g key={`${event.label}-${event.sec}`}>
                <line x1={x} y1={0} x2={x} y2={innerHeight} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} />
                <text x={x + 2} y={12} fill="#fca5a5" fontSize={10}>{event.label}</text>
              </g>
            );
          })}

          {series.map((s) => (
            <LinePath
              key={`${title}-${s.label}`}
              data={s.values.map((v, i) => ({ x: samples[i], y: v }))}
              x={(d) => xScale(d.x)}
              y={(d) => yScale((d.y ?? minY) as number)}
              defined={(d) => d.y != null}
              stroke={s.color}
              strokeWidth={2}
              fill="none"
            />
          ))}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={6}
            stroke="#94a3b8"
            tickStroke="#94a3b8"
            tickLabelProps={() => ({ fill: "#94a3b8", fontSize: 11, textAnchor: "middle", dy: "0.25em" })}
          />
          <AxisLeft
            scale={yScale}
            numTicks={6}
            stroke="#cbd5e1"
            tickStroke="#cbd5e1"
            tickLabelProps={() => ({ fill: "#cbd5e1", fontSize: 11, textAnchor: "end", dx: "-0.3em", dy: "0.25em" })}
          />
        </Group>
      </svg>
      <div class="graph-legend">
        {series.map((s) => (
          <span key={`${title}-legend-${s.label}`}>
            <i style={{ backgroundColor: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RoastGraphs({
  roast,
  mode = "separate",
  heightScale = 1,
  profile,
  profileStartOffsetSec = 0,
}: {
  roast?: RoastState;
  mode?: RoastGraphMode;
  heightScale?: number;
  profile?: Profile;
  profileStartOffsetSec?: number;
}) {
  const measurements = roast?.measurements ?? [];
  const start = roast?.startDate;
  const activeProfile = profile ?? roast?.profile;

  if (!start || measurements.length < 2) {
    if (!activeProfile?.steps.length) {
      return (
        <VisxLineGraph
          title="Roast Graph (idle preview)"
          samples={[0, 60]}
          minY={0}
          maxY={300}
          height={Math.round(320 * Math.min(1.8, Math.max(0.7, heightScale)))}
          series={[]}
        />
      );
    }
    return buildProfilePreviewGraph(activeProfile, heightScale);
  }

  const sampleTimes = measurements.map((m) => (m.timestamp.getTime() - start.getTime()) / 1000);
  const bt = measurements.map((m) => m.message.BT);
  const et = measurements.map((m) => m.message.ET);
  const setpoint = measurements.map((m) => m.extra?.setpoint ?? 0);
  const fan = measurements.map((m) => m.message.FanVal);
  const heater = measurements.map((m) => m.message.BurnerVal);
  const btRor = buildRoR(bt, sampleTimes);
  const etRor = buildRoR(et, sampleTimes);
  const profileSetpoint = activeProfile
    ? sampleTimes.map((seconds) =>
        seconds < profileStartOffsetSec
          ? null
          : getProfileSetpointAtElapsed(activeProfile, seconds - profileStartOffsetSec),
      )
    : [];
  const fullTimelineEnd =
    activeProfile?.steps.length
      ? Math.max(
          sampleTimes[sampleTimes.length - 1] ?? 0,
          activeProfile.steps.reduce((sum, step) => sum + Math.max(0, step.duration), 0),
        )
      : sampleTimes[sampleTimes.length - 1] ?? 0;
  const chartSamples =
    fullTimelineEnd > (sampleTimes[sampleTimes.length - 1] ?? 0)
      ? [...sampleTimes, fullTimelineEnd]
      : sampleTimes;
  const maybeExtendSeries = (values: Array<number | null>, fill: number | null) =>
    chartSamples.length > sampleTimes.length ? [...values, fill] : values;

  const eventTimes = (roast?.events ?? []).map((event) => ({
    label: String(event.label),
    sec: (event.measurement.timestamp.getTime() - start.getTime()) / 1000,
  }));

  const clampedHeightScale = Math.min(1.8, Math.max(0.7, heightScale));
  const separateHeight = Math.round(300 * clampedHeightScale);
  const combinedHeight = Math.round(380 * clampedHeightScale);

  if (mode === "combined") {
    return (
      <div class="graph-stack">
        {activeProfile?.steps.length ? buildProfilePreviewGraph(activeProfile, heightScale) : null}
        <VisxLineGraph
          title="Combined Roast Telemetry"
          samples={chartSamples}
          minY={0}
          maxY={300}
          height={combinedHeight}
          eventTimes={eventTimes}
          series={[
            { label: "BT", color: "#60a5fa", values: maybeExtendSeries(bt, null) },
            { label: "ET", color: "#f87171", values: maybeExtendSeries(et, null) },
            { label: "Setpoint", color: "#34d399", values: maybeExtendSeries(setpoint, null) },
            ...(profileSetpoint.length
              ? [{ label: "Profile", color: "#facc15", values: maybeExtendSeries(profileSetpoint, profileSetpoint[profileSetpoint.length - 1]) }]
              : []),
            { label: "Fan % (x3)", color: "#38bdf8", values: maybeExtendSeries(fan.map((v) => v * 3), null) },
            { label: "Heater % (x3)", color: "#fb923c", values: maybeExtendSeries(heater.map((v) => v * 3), null) },
            { label: "BT RoR (x5)", color: "#22c55e", values: maybeExtendSeries(btRor.map((v) => (v == null ? null : Math.max(v, 0) * 5)), null) },
            { label: "ET RoR (x5)", color: "#a855f7", values: maybeExtendSeries(etRor.map((v) => (v == null ? null : Math.max(v, 0) * 5)), null) },
          ]}
        />
      </div>
    );
  }

  return (
    <div class="graph-stack">
      {activeProfile?.steps.length ? buildProfilePreviewGraph(activeProfile, heightScale) : null}
      <VisxLineGraph
        title="Temperature"
        samples={chartSamples}
        minY={0}
        maxY={300}
        height={separateHeight}
        eventTimes={eventTimes}
        series={[
          { label: "BT", color: "#60a5fa", values: maybeExtendSeries(bt, null) },
          { label: "ET", color: "#f87171", values: maybeExtendSeries(et, null) },
          { label: "Setpoint", color: "#34d399", values: maybeExtendSeries(setpoint, null) },
          ...(profileSetpoint.length
            ? [{ label: "Profile", color: "#facc15", values: maybeExtendSeries(profileSetpoint, profileSetpoint[profileSetpoint.length - 1]) }]
            : []),
        ]}
      />
      <VisxLineGraph
        title="Power"
        samples={chartSamples}
        minY={0}
        maxY={100}
        height={separateHeight}
        series={[
          { label: "Fan %", color: "#38bdf8", values: maybeExtendSeries(fan, null) },
          { label: "Heater %", color: "#fb923c", values: maybeExtendSeries(heater, null) },
        ]}
      />
      <VisxLineGraph
        title="Rate of Rise"
        samples={chartSamples}
        minY={-5}
        maxY={60}
        height={separateHeight}
        series={[
          { label: "BT RoR", color: "#22c55e", values: maybeExtendSeries(btRor, null) },
          { label: "ET RoR", color: "#a855f7", values: maybeExtendSeries(etRor, null) },
        ]}
      />
    </div>
  );
}

type ProfileEditorGraphProps = {
  profile: Profile;
  onChange: (next: Profile) => void;
};

type DragMode = "temp" | "fan" | null;

export function ProfileEditorGraph({ profile, onChange }: ProfileEditorGraphProps) {
  const totalDuration = Math.max(60, profile.steps.reduce((sum, step) => sum + Math.max(1, step.duration), 0));
  const width = 900;
  const height = 280;
  const innerHeight = 220;
  const margin = { top: 24, right: 28, bottom: 34, left: 52 };
  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, totalDuration],
        range: [0, width - margin.left - margin.right],
      }),
    [totalDuration],
  );
  const tempScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, 300],
        range: [innerHeight, 0],
      }),
    [],
  );
  const fanScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, 100],
        range: [innerHeight, 0],
      }),
    [],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ index: number; mode: DragMode } | null>(null);
  const points = useMemo(() => {
    let elapsed = 0;
    return profile.steps.map((step, index) => {
      elapsed += Math.max(1, step.duration);
      return {
        index,
        sec: elapsed,
        setpoint: step.setpoint,
        fan: step.fanValue ?? 0,
      };
    });
  }, [profile.steps]);

  const updateFromPointer = (event: PointerEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const localX = event.clientX - rect.left - margin.left;
    const localY = event.clientY - rect.top - margin.top;
    const next = {
      steps: profile.steps.map((s) => ({ ...s })),
    };
    const point = points[dragging.index];
    if (!point) return;
    if (dragging.mode === "temp") {
      const temp = Math.max(0, Math.min(300, Math.round(tempScale.invert(localY))));
      next.steps[dragging.index].setpoint = temp;
    } else if (dragging.mode === "fan") {
      const fan = Math.max(0, Math.min(100, Math.round(fanScale.invert(localY) / 5) * 5));
      next.steps[dragging.index].fanValue = fan;
    }

    const proposedSec = Math.max(15, Math.min(totalDuration, Math.round(xScale.invert(localX))));
    if (dragging.index >= 0) {
      const prevEdge = dragging.index === 0 ? 0 : points[dragging.index - 1].sec;
      const nextEdge = dragging.index === points.length - 1 ? totalDuration : points[dragging.index + 1].sec;
      const clampedSec = Math.max(prevEdge + 15, Math.min(nextEdge - 15, proposedSec));
      const prevSec = point.sec;
      const delta = clampedSec - prevSec;
      next.steps[dragging.index].duration = Math.max(15, next.steps[dragging.index].duration + delta);
      if (dragging.index + 1 < next.steps.length) {
        next.steps[dragging.index + 1].duration = Math.max(15, next.steps[dragging.index + 1].duration - delta);
      }
    }
    onChange(next);
  };

  return (
    <div class="graph-card">
      <h4>Profile Editor (drag phase points)</h4>
      <svg
        ref={svgRef}
        class="line-graph profile-editor-graph"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onPointerMove={(event) => updateFromPointer(event as unknown as PointerEvent)}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        <rect x={0} y={0} width={width} height={height} fill="#0f172a" rx={8} />
        <Group top={margin.top} left={margin.left}>
          {gridTicks(0, 300, 6).map((tick) => (
            <line key={`t-${tick}`} x1={0} y1={tempScale(tick)} x2={width - margin.left - margin.right} y2={tempScale(tick)} stroke="rgba(148,163,184,0.18)" />
          ))}
          <AxisBottom top={innerHeight} scale={xScale} numTicks={6} stroke="#94a3b8" tickStroke="#94a3b8" tickLabelProps={() => ({ fill: "#94a3b8", fontSize: 11, textAnchor: "middle", dy: "0.25em" })} />
          <AxisLeft scale={tempScale} numTicks={7} stroke="#cbd5e1" tickStroke="#cbd5e1" tickLabelProps={() => ({ fill: "#cbd5e1", fontSize: 11, textAnchor: "end", dx: "-0.3em", dy: "0.25em" })} />
          <LinePath data={points} x={(d) => xScale(d.sec)} y={(d) => tempScale(d.setpoint)} stroke="#facc15" strokeWidth={2.2} fill="none" />
          <LinePath data={points} x={(d) => xScale(d.sec)} y={(d) => fanScale(d.fan)} stroke="#38bdf8" strokeWidth={1.8} fill="none" strokeDasharray="4 3" />
          {points.map((point) => (
            <g key={`point-${point.index}`}>
              <circle
                cx={xScale(point.sec)}
                cy={tempScale(point.setpoint)}
                r={6}
                fill="#facc15"
                onPointerDown={() => setDragging({ index: point.index, mode: "temp" })}
              />
              <circle
                cx={xScale(point.sec)}
                cy={fanScale(point.fan)}
                r={5}
                fill="#38bdf8"
                onPointerDown={() => setDragging({ index: point.index, mode: "fan" })}
              />
            </g>
          ))}
        </Group>
      </svg>
      <div class="graph-legend">
        <span><i style={{ backgroundColor: "#facc15" }} /> Temp setpoint</span>
        <span><i style={{ backgroundColor: "#38bdf8" }} /> Fan (%)</span>
      </div>
    </div>
  );
}

export function AutotuneGraph({
  history,
  target,
  setpoint,
}: {
  history: Array<{ ET: number; BT: number; simBT: number }>;
  target: "BT" | "ET" | "simBT";
  setpoint: number;
}) {
  const values = history.map((s) => (target === "ET" ? s.ET : target === "simBT" ? s.simBT : s.BT));
  const samples = values.map((_, i) => i);

  return (
    <VisxLineGraph
      title="Autotune target trend"
      samples={samples}
      minY={Math.min(...values, setpoint) - 3}
      maxY={Math.max(...values, setpoint) + 3}
      height={320}
      series={[
        { label: `${target} sensor`, color: "#22d3ee", values },
        { label: "Setpoint", color: "#94a3b8", values: values.map(() => setpoint) },
      ]}
    />
  );
}
