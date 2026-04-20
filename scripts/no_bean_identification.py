#!/usr/bin/env python3
"""Estimate empty-roaster dynamics from Yaeger control logs.

Input may be either:
  * CSV with columns like ms,uh,uf,Tb,Te,dT,RoR
  * Serial lines emitted by firmware, e.g. "control_log ms=... uh=... Tb=..."

The output is JSON with coarse characteristics suitable for initial PID/Smith,
ADRC scheduling, fuzzy scaling, and MPC seed models. These are intentionally
empty-machine estimates; runtime scheduling/adaptation should still account for
bean-loaded differences.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import median
from typing import Iterable


CONTROL_LOG_RE = re.compile(r"([A-Za-z][A-Za-z0-9]*)=([^ ]+)")


@dataclass
class Sample:
    t: float
    uh: float
    uf: float
    tb: float
    te: float
    dt: float
    ror: float | None = None


@dataclass
class Characteristics:
    lag_seconds: float | None
    tau_tb_seconds: float | None
    tau_te_seconds: float | None
    gain_tb_per_heater: float | None
    gain_te_per_heater: float | None
    gain_tb_per_fan: float | None
    gain_te_per_fan: float | None
    dT_gain: float | None
    adrc_b0: float
    adrc_w0: float
    adrc_wc: float
    fuzzy_eT_scale: float
    fuzzy_eRoR_scale: float
    fuzzy_dT_low: float
    fuzzy_dT_high: float
    mpc_model: dict[str, float]


def finite(value: object) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(out):
        return None
    return out


def parse_control_log_line(line: str) -> Sample | None:
    if "control_log" not in line:
        return None
    values = dict(CONTROL_LOG_RE.findall(line))
    ms = finite(values.get("ms"))
    tb = finite(values.get("Tb"))
    te = finite(values.get("Te"))
    uh = finite(values.get("uh"))
    uf = finite(values.get("uf"))
    if None in (ms, tb, te, uh, uf):
        return None
    dt_value = finite(values.get("dT"))
    ror = finite(values.get("RoR"))
    return Sample(t=ms / 1000.0, uh=uh, uf=uf, tb=tb, te=te, dt=dt_value if dt_value is not None else te - tb, ror=ror)


def load_samples(path: Path) -> list[Sample]:
    text = path.read_text(errors="replace")
    log_samples = [sample for line in text.splitlines() if (sample := parse_control_log_line(line)) is not None]
    if log_samples:
        return normalize_time(log_samples)

    rows = list(csv.DictReader(text.splitlines()))
    samples: list[Sample] = []
    for row in rows:
        t = finite(row.get("t")) or finite(row.get("time")) or ((finite(row.get("ms")) or 0.0) / 1000.0)
        uh = finite(row.get("uh")) or finite(row.get("BurnerVal")) or finite(row.get("heater"))
        uf = finite(row.get("uf")) or finite(row.get("FanVal")) or finite(row.get("fan"))
        tb = finite(row.get("Tb")) or finite(row.get("BT")) or finite(row.get("filteredBT"))
        te = finite(row.get("Te")) or finite(row.get("ET")) or finite(row.get("filteredET"))
        if None in (t, uh, uf, tb, te):
            continue
        dt_value = finite(row.get("dT"))
        ror = finite(row.get("RoR")) or finite(row.get("ror"))
        samples.append(Sample(t=t, uh=uh, uf=uf, tb=tb, te=te, dt=dt_value if dt_value is not None else te - tb, ror=ror))
    return normalize_time(samples)


def normalize_time(samples: list[Sample]) -> list[Sample]:
    samples = sorted(samples, key=lambda s: s.t)
    if not samples:
        return []
    offset = samples[0].t
    return [Sample(t=s.t - offset, uh=s.uh, uf=s.uf, tb=s.tb, te=s.te, dt=s.dt, ror=s.ror) for s in samples]


def robust_mean(values: Iterable[float]) -> float | None:
    vals = sorted(v for v in values if math.isfinite(v))
    if not vals:
        return None
    if len(vals) < 5:
        return sum(vals) / len(vals)
    lo = len(vals) // 10
    hi = len(vals) - lo
    trimmed = vals[lo:hi] or vals
    return sum(trimmed) / len(trimmed)


def first_response_lag(samples: list[Sample], field: str, threshold: float = 0.2) -> float | None:
    if len(samples) < 3:
        return None
    baseline = robust_mean(getattr(s, field) for s in samples[: max(3, len(samples) // 10)])
    if baseline is None:
        return None
    for sample in samples:
        if abs(getattr(sample, field) - baseline) >= threshold:
            return sample.t
    return None


def dominant_time_constant(samples: list[Sample], field: str) -> float | None:
    if len(samples) < 4:
        return None
    start = robust_mean(getattr(s, field) for s in samples[: max(3, len(samples) // 10)])
    end = robust_mean(getattr(s, field) for s in samples[-max(3, len(samples) // 10) :])
    if start is None or end is None or abs(end - start) < 0.1:
        return None
    target = start + 0.632 * (end - start)
    for sample in samples:
        value = getattr(sample, field)
        if (end >= start and value >= target) or (end < start and value <= target):
            return sample.t
    return None


def estimate_gain(samples: list[Sample], output_field: str, input_field: str) -> float | None:
    if len(samples) < 6:
        return None
    y0 = robust_mean(getattr(s, output_field) for s in samples[: max(3, len(samples) // 10)])
    y1 = robust_mean(getattr(s, output_field) for s in samples[-max(3, len(samples) // 10) :])
    u0 = robust_mean(getattr(s, input_field) for s in samples[: max(3, len(samples) // 10)])
    u1 = robust_mean(getattr(s, input_field) for s in samples[-max(3, len(samples) // 10) :])
    if None in (y0, y1, u0, u1) or abs(u1 - u0) < 0.5:
        return None
    return (y1 - y0) / (u1 - u0)


def slope_scale(samples: list[Sample], field: str) -> float:
    slopes: list[float] = []
    for prev, cur in zip(samples, samples[1:]):
        dt = cur.t - prev.t
        if dt > 0:
            slopes.append(abs((getattr(cur, field) - getattr(prev, field)) / dt))
    return max(0.001, median(slopes) if slopes else 0.001)


def estimate(samples: list[Sample]) -> Characteristics:
    if len(samples) < 6:
        raise SystemExit("Need at least 6 usable samples")

    lag = first_response_lag(samples, "tb")
    tau_tb = dominant_time_constant(samples, "tb")
    tau_te = dominant_time_constant(samples, "te")
    gain_tb_h = estimate_gain(samples, "tb", "uh")
    gain_te_h = estimate_gain(samples, "te", "uh")
    gain_tb_f = estimate_gain(samples, "tb", "uf")
    gain_te_f = estimate_gain(samples, "te", "uf")
    dT_gain = estimate_gain(samples, "dt", "uh")

    max_tb_slope = slope_scale(samples, "tb")
    adrc_b0 = min(1.0, max(0.001, max_tb_slope / max(1.0, max(s.uh for s in samples) - min(s.uh for s in samples))))
    adrc_w0 = min(4.0, max(0.2, 1.0 / max(0.25, lag or tau_tb or 1.0)))
    adrc_wc = min(1.0, max(0.05, adrc_w0 / 4.0))

    rors = [s.ror for s in samples if s.ror is not None and math.isfinite(s.ror)]
    dts = sorted(s.dt for s in samples if math.isfinite(s.dt))
    fuzzy_e_ror = max(5.0, (max(rors) - min(rors)) if rors else max_tb_slope * 120.0)
    fuzzy_e_t = max(5.0, abs((samples[-1].tb - samples[0].tb) * 0.5))
    dT_low = dts[len(dts) // 10] if dts else 10.0
    dT_high = dts[(len(dts) * 9) // 10] if dts else 70.0

    dt_median = median([b.t - a.t for a, b in zip(samples, samples[1:]) if b.t > a.t] or [0.4])
    tau = max(dt_median, tau_tb or 25.0)
    a_tb = math.exp(-dt_median / tau)
    tau_e = max(dt_median, tau_te or max(5.0, tau * 0.6))
    a_te = math.exp(-dt_median / tau_e)

    return Characteristics(
        lag_seconds=lag,
        tau_tb_seconds=tau_tb,
        tau_te_seconds=tau_te,
        gain_tb_per_heater=gain_tb_h,
        gain_te_per_heater=gain_te_h,
        gain_tb_per_fan=gain_tb_f,
        gain_te_per_fan=gain_te_f,
        dT_gain=dT_gain,
        adrc_b0=adrc_b0,
        adrc_w0=adrc_w0,
        adrc_wc=adrc_wc,
        fuzzy_eT_scale=fuzzy_e_t,
        fuzzy_eRoR_scale=fuzzy_e_ror,
        fuzzy_dT_low=dT_low,
        fuzzy_dT_high=dT_high,
        mpc_model={
            "aTb": a_tb,
            "aTe": a_te,
            "bTbHeater": gain_tb_h or 0.025,
            "bTbFan": gain_tb_f or -0.010,
            "bTeHeater": gain_te_h or 0.060,
            "bTeFan": gain_te_f or -0.035,
            "sampleSeconds": dt_median,
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("logfile", type=Path)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    samples = load_samples(args.logfile)
    result = asdict(estimate(samples))
    print(json.dumps(result, indent=2 if args.pretty else None, sort_keys=True))


if __name__ == "__main__":
    main()
