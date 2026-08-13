#!/usr/bin/env python3
"""
gen_segmentation.py — synthetic behavioural clusters for the segmentation case study.

WHAT REAL SHAPE THIS PRESERVES
------------------------------
The original work turned 90 days of cook-level IoT telemetry into device-level
behavioural profiles and clustered them with k-means, cross-checked against a
hierarchical clustering of the same features. The findings that survive into
this synthetic version:

  * The feature set is behavioural, not demographic: how long people cook, how
    hot, how often they touch the dial mid-cook, whether they use the smoke
    mode, and whether they cook on weekends.
  * One segment is much bigger than the rest — most people set a temperature
    once and leave it alone.
  * Splitting further keeps peeling a "very long cook" group off the low-and-slow
    crowd rather than producing genuinely new behaviour, which is exactly what
    an elbow plot is supposed to tell you.

Segment names here are invented. Real cluster labels, real cluster sizes and
the real feature distributions are not reproduced.

The elbow curve at the bottom is not fabricated: it is computed by actually
running k-means over the generated sample for k = 2..8.

Run:  python3 gen_segmentation.py
Out:  ../segmentation/{devices,segments,rollup,elbow}.json
"""

import json
import math
import os
import random

SEED = 90_000_090         # 90 days, twice, for luck
RNG = random.Random(SEED)

OUT = os.path.join(os.path.dirname(__file__), "..", "segmentation")

SAMPLE = 1800             # devices drawn for the scatter; the real model ran
                          # on the full device population
FLEET = 512_000           # devices with enough cooks in the window

# Each segment: display name, share of the population, and the centre + spread
# of every feature. Order is the order they appear in the legend.
#   dur   avg cook duration, minutes
#   temp  avg set temperature, °F
#   smoke share of cooks with the smoke mode on, %
#   wknd  share of cooks on Sat/Sun, %
#   chg   avg distinct set points used per cook (1 = set once, walked away)
#   ramp  share of cooks where the user raised the target 35°F+ mid-cook, %
SEGMENTS = [
    {
        "key": "default", "name": "Everyday Default", "share": 0.335,
        "blurb": "Sets one temperature in the middle of the dial and leaves it. "
                 "The single biggest group by a wide margin.",
        "f": {"dur": (74, 22), "temp": (352, 26), "smoke": (7, 5),
              "wknd": (33, 10), "chg": (1.15, 0.18), "ramp": (6, 4)},
    },
    {
        "key": "sear", "name": "Quick Sear", "share": 0.205,
        "blurb": "Short, hot, mid-week. Weeknight dinner rather than a project.",
        "f": {"dur": (41, 12), "temp": (438, 30), "smoke": (3, 3),
              "wknd": (22, 9), "chg": (1.25, 0.22), "ramp": (9, 6)},
    },
    {
        "key": "longburn", "name": "Long Burn", "share": 0.170,
        "blurb": "Classic barbecue. Long cooks at low temperature with the "
                 "smoke mode on more often than not.",
        "f": {"dur": (243, 58), "temp": (232, 22), "smoke": (54, 16),
              "wknd": (49, 13), "chg": (1.6, 0.4), "ramp": (17, 9)},
    },
    {
        "key": "ritual", "name": "Saturday Ritual", "share": 0.145,
        "blurb": "Cooks almost exclusively at the weekend, and not often. "
                 "Low engagement, high intent.",
        "f": {"dur": (112, 34), "temp": (327, 34), "smoke": (18, 11),
              "wknd": (79, 9), "chg": (1.3, 0.28), "ramp": (11, 7)},
    },
    {
        "key": "tinkerer", "name": "The Tinkerer", "share": 0.100,
        "blurb": "Actively manages heat through the cook — reverse sears, "
                 "multi-stage ramps, constant small adjustments.",
        "f": {"dur": (158, 46), "temp": (318, 30), "smoke": (31, 15),
              "wknd": (44, 13), "chg": (3.7, 0.9), "ramp": (58, 15)},
    },
    {
        "key": "overnight", "name": "The Overnighter", "share": 0.045,
        "blurb": "Twelve-hour-plus cooks, mostly starting Friday or Saturday "
                 "night. A subset of Long Burn with real stamina.",
        "f": {"dur": (612, 128), "temp": (218, 16), "smoke": (68, 15),
              "wknd": (71, 12), "chg": (1.9, 0.6), "ramp": (22, 11)},
    },
]

FEATURES = ["dur", "temp", "smoke", "wknd", "chg", "ramp"]
FEATURE_LABELS = {
    "dur": "Avg cook duration (min)",
    "temp": "Avg set temp (°F)",
    "smoke": "% cooks with smoke mode",
    "wknd": "% weekend cooks",
    "chg": "Avg set points per cook",
    "ramp": "% cooks with a mid-cook ramp up",
}
CLAMP = {
    "dur": (12, 1440), "temp": (165, 500), "smoke": (0, 100),
    "wknd": (0, 100), "chg": (1.0, 9.0), "ramp": (0, 100),
}


def draw(seg):
    """One synthetic device profile from a segment."""
    row = {}
    # A shared per-device "intensity" factor correlates the features — someone
    # who cooks long also tends to use smoke mode. Independent draws would give
    # perfectly round blobs, which is not what real behaviour looks like.
    intensity = RNG.gauss(0, 1)
    for k in FEATURES:
        mu, sd = seg["f"][k]
        loading = 0.45 if k in ("dur", "smoke", "ramp") else 0.15
        v = mu + sd * (loading * intensity + math.sqrt(1 - loading ** 2) * RNG.gauss(0, 1))
        lo, hi = CLAMP[k]
        row[k] = round(max(lo, min(hi, v)), 2 if k == "chg" else 1)
    row["cooks"] = max(3, int(RNG.lognormvariate(2.5, 0.75)))
    return row


def build_devices():
    rows = []
    for i in range(SAMPLE):
        r = RNG.random()
        acc = 0.0
        chosen = SEGMENTS[-1]
        for seg in SEGMENTS:
            acc += seg["share"]
            if r <= acc:
                chosen = seg
                break
        row = draw(chosen)
        row["segment"] = chosen["key"]
        row["id"] = "dev_%05d" % i
        rows.append(row)
    return rows


# --- a small k-means, so the elbow plot is a real result --------------------

def normalise(rows):
    """Z-score each feature; k-means on raw units would be dominated by
    duration, which spans two orders of magnitude more than the rest."""
    stats = {}
    for k in FEATURES:
        vals = [r[k] for r in rows]
        mu = sum(vals) / len(vals)
        sd = math.sqrt(sum((v - mu) ** 2 for v in vals) / len(vals)) or 1.0
        stats[k] = (mu, sd)
    return [[(r[k] - stats[k][0]) / stats[k][1] for k in FEATURES] for r in rows], stats


def kmeans(points, k, iters=40, restarts=4):
    """Plain Lloyd's algorithm with k-means++ seeding and a few restarts."""
    best, best_wss = None, float("inf")
    for _ in range(restarts):
        centres = [list(points[RNG.randrange(len(points))])]
        while len(centres) < k:
            d2 = [min(sum((p[i] - c[i]) ** 2 for i in range(len(p))) for c in centres)
                  for p in points]
            total = sum(d2) or 1.0
            pick, acc = RNG.random() * total, 0.0
            for idx, d in enumerate(d2):
                acc += d
                if acc >= pick:
                    centres.append(list(points[idx]))
                    break
        for _ in range(iters):
            groups = [[] for _ in range(k)]
            for p in points:
                bi, bd = 0, float("inf")
                for ci, c in enumerate(centres):
                    d = sum((p[i] - c[i]) ** 2 for i in range(len(p)))
                    if d < bd:
                        bd, bi = d, ci
                groups[bi].append(p)
            moved = False
            for ci, g in enumerate(groups):
                if not g:
                    continue
                new = [sum(p[i] for p in g) / len(g) for i in range(len(g[0]))]
                if any(abs(new[i] - centres[ci][i]) > 1e-6 for i in range(len(new))):
                    moved = True
                centres[ci] = new
            if not moved:
                break
        wss = 0.0
        for p in points:
            wss += min(sum((p[i] - c[i]) ** 2 for i in range(len(p))) for c in centres)
        if wss < best_wss:
            best_wss, best = wss, centres
    return best, best_wss


def profiles(rows):
    """Segment-level averages — the table the report was built around."""
    out = []
    for seg in SEGMENTS:
        members = [r for r in rows if r["segment"] == seg["key"]]
        if not members:
            continue
        prof = {k: round(sum(r[k] for r in members) / len(members),
                         2 if k == "chg" else 1) for k in FEATURES}
        out.append({
            "key": seg["key"],
            "name": seg["name"],
            "blurb": seg["blurb"],
            "share": round(100.0 * len(members) / len(rows), 1),
            "devices": int(round(FLEET * len(members) / len(rows))),
            "profile": prof,
        })
    return out


def rollup():
    """Rows in, segments out — the shape of the pipeline itself."""
    return {
        "meta": {"synthetic": True, "seed": SEED},
        "stages": [
            {"label": "Telemetry rows read", "value": 5_000_000,
             "detail": "90 days of cook-level events across the connected fleet"},
            {"label": "Valid cooks after filters", "value": 3_640_000,
             "detail": "Drops cooks under 5 minutes, missing set points, and "
                       "sensor glitches below 50°C"},
            {"label": "Devices with 3+ cooks", "value": FLEET,
             "detail": "The population the model is allowed to speak about"},
            {"label": "Behavioural segments", "value": len(SEGMENTS),
             "detail": "k-means, cross-checked against hierarchical clustering"},
        ],
    }


def write(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = build_devices()
    pts, stats = normalise(rows)

    elbow = []
    for k in range(2, 9):
        _, wss = kmeans(pts, k)
        elbow.append({"k": k, "wss": round(wss, 1)})
        print("  k=%d  within-cluster SS = %8.1f" % (k, wss))

    write(os.path.join(OUT, "devices.json"), {
        "meta": {
            "synthetic": True, "seed": SEED, "sample": SAMPLE, "fleet": FLEET,
            "features": [{"key": k, "label": FEATURE_LABELS[k]} for k in FEATURES],
        },
        "rows": rows,
    })
    write(os.path.join(OUT, "segments.json"), {
        "meta": {"synthetic": True, "seed": SEED, "fleet": FLEET},
        "rows": profiles(rows),
    })
    write(os.path.join(OUT, "elbow.json"), {
        "meta": {"synthetic": True, "seed": SEED,
                 "note": "Computed by running k-means on the generated sample."},
        "rows": elbow,
    })
    write(os.path.join(OUT, "rollup.json"), rollup())

    print("segmentation: %d sampled devices, %d segments" % (len(rows), len(SEGMENTS)))
    for p in profiles(rows):
        print("  %-18s %5.1f%%  dur %6.1f  temp %5.1f  smoke %4.1f  chg %.2f"
              % (p["name"], p["share"], p["profile"]["dur"], p["profile"]["temp"],
                 p["profile"]["smoke"], p["profile"]["chg"]))


if __name__ == "__main__":
    main()
