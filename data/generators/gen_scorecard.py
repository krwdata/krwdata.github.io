#!/usr/bin/env python3
"""
gen_scorecard.py — synthetic thermal-test data for the Scorecard API case study.

WHAT REAL SHAPE THIS PRESERVES
------------------------------
A standard thermal test drives a grill controller through a staircase of set
points and logs two temperature channels:

  * grill temp — the controller's own RTD, near the heat source. Responds fast,
    reads hotter than the cooking surface, overshoots on a step up, then
    settles into a sawtooth as the auger cycles.
  * grate temp — an external thermocouple at cooking height. This is the
    channel the controller is calibrated against, so it lands near the set
    point; it lags the grill channel and smooths out most of the sawtooth.

A real unit tracks target well at low and mid set points and sags at the top
of its range, where there is no headroom left. That is the shape the grades
below reproduce, and it is the finding the scorecard exists to surface.

The scorecard grades each set point on two things a test engineer actually
cares about: how close the grate settles to target (accuracy) and how tightly
it holds once settled (stability). Everything below is generated from a
first-order thermal model with a seeded RNG — no measured data is used.

Run:  python3 gen_scorecard.py
Out:  ../scorecard/trace.json, ../scorecard/grades.json, ../scorecard/timing.json
"""

import json
import math
import os
import random

SEED = 20250307          # date the real API went to production; just a seed
RNG = random.Random(SEED)

OUT = os.path.join(os.path.dirname(__file__), "..", "scorecard")

# --- test profile -----------------------------------------------------------
# Set-point staircase in °F with dwell time in minutes at each step. A real
# standard test is a ramp through the usable range with enough dwell to reach
# steady state at every stop.
PROFILE = [
    (180, 14),   # smoke setting
    (225, 14),   # low & slow
    (325, 14),   # roast
    (375, 12),   # bake
    (450, 12),   # sear approach
    (500, 14),   # max
]
SAMPLE_S = 10            # DAQ sample period, seconds
AMBIENT = 68.0           # °F at test start


def first_order(prev, target, tau_s, dt_s):
    """Exponential approach to target with time constant tau."""
    return prev + (target - prev) * (1.0 - math.exp(-dt_s / tau_s))


def build_trace():
    """Simulate the two temperature channels across the whole staircase."""
    t = 0
    grill = AMBIENT
    grate = AMBIENT
    rows = []
    segments = []

    # Preheat: controller drives hard to the first set point.
    schedule = []
    for sp, mins in PROFILE:
        schedule.append((sp, int(mins * 60)))

    elapsed = 0
    for idx, (sp, dur_s) in enumerate(schedule):
        seg_start = elapsed
        # Time constants: the grill channel is quick, the grate is sluggish.
        # Both get slower at high set points — more mass to heat, less headroom.
        tau_grill = 70 + sp * 0.09
        tau_grate = 100 + sp * 0.06

        # Real controllers overshoot on a step up and settle back. Model it as a
        # temporary target above the set point that decays over the first
        # third of the dwell.
        step_up = sp - (schedule[idx - 1][0] if idx else AMBIENT)
        overshoot_peak = min(38.0, max(0.0, step_up * 0.11))

        # The controller is tuned against the cooking surface, so the grate
        # settles near target — but it sags progressively at the top of the
        # range where the burn pot has no headroom left. The controller probe
        # sits closer to the fire and always reads hotter.
        grate_bias = 3.0 - (sp - 180) * 0.055
        grill_offset = 9.0 + sp * 0.030

        for s in range(0, dur_s, SAMPLE_S):
            frac = s / float(dur_s)
            decay = math.exp(-frac * 7.0)
            target_grill = sp + grill_offset + overshoot_peak * decay

            grill = first_order(grill, target_grill, tau_grill, SAMPLE_S)
            # Auger cycling: the pellet feed is discrete, so the controller
            # probe oscillates a few degrees on a ~3.5 min period.
            cycle = 3.4 * math.sin(2 * math.pi * (elapsed + s) / 210.0)
            grill_s = grill + cycle + RNG.gauss(0, 0.9)

            grate = first_order(grate, sp + grate_bias, tau_grate, SAMPLE_S)
            # The grate sees a damped, delayed version of the auger cycle.
            grate_s = grate + cycle * 0.28 + RNG.gauss(0, 1.4)

            rows.append({
                "t": round((elapsed + s) / 60.0, 3),          # minutes
                "set": sp,
                "grill": round(grill_s, 1),
                "grate": round(grate_s, 1),
            })

        segments.append({
            "set": sp,
            "start_min": round(seg_start / 60.0, 2),
            "end_min": round((seg_start + dur_s) / 60.0, 2),
        })
        elapsed += dur_s

    return rows, segments


def grade_segments(rows, segments):
    """Score each set point the way the scorecard does.

    Steady state = the second half of the dwell, which excludes the ramp and
    the overshoot. Accuracy is mean grate error vs. target; stability is the spread
    of the grate channel once settled.
    """
    out = []
    for seg in segments:
        span = seg["end_min"] - seg["start_min"]
        settle_from = seg["start_min"] + span * 0.5
        vals = [r["grate"] for r in rows
                if settle_from <= r["t"] < seg["end_min"]]
        grill_vals = [r["grill"] for r in rows
                      if settle_from <= r["t"] < seg["end_min"]]
        if not vals:
            continue
        mean = sum(vals) / len(vals)
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        sd = math.sqrt(var)
        err = mean - seg["set"]

        # Rise time: minutes from the step to first touching within 10°F.
        rise = None
        for r in rows:
            if r["t"] < seg["start_min"] or r["t"] >= seg["end_min"]:
                continue
            if abs(r["grate"] - seg["set"]) <= 10:
                rise = round(r["t"] - seg["start_min"], 1)
                break

        peak = max((r["grill"] for r in rows
                    if seg["start_min"] <= r["t"] < seg["end_min"]), default=0)

        # Letter grade: accuracy dominates, stability breaks ties. Thresholds
        # scale with set point because holding ±10°F at 500 is harder than
        # at 225.
        tol = max(8.0, seg["set"] * 0.025)
        score = abs(err) / tol + (sd / (tol * 0.75)) * 0.6
        grade = ("A" if score < 0.75 else
                 "B" if score < 1.05 else
                 "C" if score < 1.45 else
                 "D" if score < 1.9 else "F")

        out.append({
            "set": seg["set"],
            "grate_avg": round(mean, 1),
            "grill_avg": round(sum(grill_vals) / len(grill_vals), 1),
            "error": round(err, 1),
            "stability_sd": round(sd, 1),
            "rise_min": rise,
            "overshoot": round(max(0.0, peak - seg["set"]), 1),
            "grade": grade,
        })
    return out


def timing_model():
    """The Past → Present numbers, as a small structured record.

    Public figures from the resume: ~3 min of human time per test per grill on
    the manual path, standard practice of 3 grills x 3 tests, so ~30 min a
    session; the API path collapses that to ~5 min of upload with no waiting
    between grills.
    """
    manual_steps = [
        ("Transfer files off the DAQ laptop", 45),
        ("Open the analysis GUI, load both CSVs", 35),
        ("Type in metadata: model, firmware, trial, test number", 55),
        ("Wait for analysis, screenshot the outputs", 25),
        ("Attach results to the ticket, write the summary", 20),
    ]
    api_steps = [
        ("Sequencer fires curl at test completion", 0),
        ("API parses both CSVs and runs the scorecard", 0),
        ("Plot image, graded table image and interactive HTML return", 0),
        ("Engineer attaches the finished outputs to the ticket", 100),
    ]
    return {
        "manual": {
            "steps": [{"label": a, "seconds": b} for a, b in manual_steps],
            "seconds_per_test_per_grill": sum(b for _, b in manual_steps),
            "grills": 3,
            "tests": 3,
        },
        "api": {
            "steps": [{"label": a, "seconds": b} for a, b in api_steps],
            "seconds_per_session": 300,
        },
        "session_minutes_before": 30,
        "session_minutes_after": 5,
        "reduction_pct": 83,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    rows, segments = build_trace()
    grades = grade_segments(rows, segments)

    write(os.path.join(OUT, "trace.json"), {
        "meta": {
            "synthetic": True,
            "seed": SEED,
            "sample_seconds": SAMPLE_S,
            "note": "First-order thermal model. Shape matches a real staircase "
                    "test; values are generated.",
        },
        "segments": segments,
        "rows": rows,
    })
    write(os.path.join(OUT, "grades.json"), {
        "meta": {"synthetic": True, "seed": SEED},
        "rows": grades,
    })
    write(os.path.join(OUT, "timing.json"), timing_model())

    print("scorecard: %d samples, %d graded set points"
          % (len(rows), len(grades)))
    for g in grades:
        print("  %4d F  grate %6.1f  err %+5.1f  sd %4.1f  -> %s"
              % (g["set"], g["grate_avg"], g["error"], g["stability_sd"], g["grade"]))


def write(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))


if __name__ == "__main__":
    main()
