#!/usr/bin/env python3
"""
gen_woodridge.py — synthetic fleet telemetry for the Woodridge case study.

WHAT REAL SHAPE THIS PRESERVES
------------------------------
The original analysis ran on a connected-grill fleet of 100K+ devices across
four SKUs, aggregating hardware alerts to a weekly grain and expressing them as
*percent of cooks affected* (deduplicated at cook level, because one failure
can emit several alert rows). None of the real values appear here. What is
reproduced is the shape:

  1. FLEET RAMP — the fleet grows on an S-curve from a few hundred devices at
     launch to six figures. This matters more than it sounds: the earliest
     weeks have a tiny denominator, which is what made the data-quality bug so
     spectacular.

  2. SEASONALITY — grilling is seasonal. Cook volume peaks in summer, bottoms
     in winter, and component B errors rise in the cold (hard starts) while
     high-temp events rise in the heat.

  3. ONE CATEGORY WITH A REAL SIGNAL — component A's series runs
     elevated for the first half of the timeline, then tapers after a component
     revision enters production. The taper is slow, not a cliff: units built
     with the earlier component keep shipping and stay in the field for a long
     time. Every other category is flat-with-noise, because that is what the
     real data looked like once it was aggregated honestly.

  4. THE BUG — see broken_trends(). The first version of the model produced
     error rates far over 100%. Rather than fake the spikes, this script
     reproduces the two mechanisms that actually caused them and lets the
     numbers fall out on their own.

  5. CHURN ATTRIBUTION — the ranking of components by error-attributed churn is
     preserved (components A and B dominate; C is a
     distant third; D and E are rare). Counts are invented.

Run:  python3 gen_woodridge.py
Out:  ../woodridge/{trends,trends_broken,churn,week_anchor,fleet}.json
"""

import datetime as dt
import json
import math
import os
import random

SEED = 20260501           # the day the week-anchor bug got fixed; just a seed
RNG = random.Random(SEED)

OUT = os.path.join(os.path.dirname(__file__), "..", "woodridge")

WEEKS = 104               # two years of weekly grain
START = dt.date(2024, 1, 1)   # synthetic timeline, not the real one
FLEET_MAX = 104_000       # "100K+ devices" — invented, right order of magnitude
INTERVENTION_WEEK = 58    # component revision enters production

# Categories tracked by the real model. Noise-only alert types (pellet level,
# lid open, grease, probes, low temp) were excluded by design and are excluded
# here too.
# Components are anonymised. The real analysis named five physical parts; which
# letter is which is not publishable, and nothing in the method depends on it.
# A is the one carrying the signal — top of the frequency ranking AND the churn
# ranking, and the one a revision had already been issued for.
CATEGORIES = ["COMP_A", "COMP_B", "COMP_C", "COMP_D", "COMP_E"]

LABELS = {
    "COMP_A": "Component A",
    "COMP_B": "Component B",
    "COMP_C": "Component C",
    "COMP_D": "Component D",
    "COMP_E": "Component E",
}

# A persistent population of engineering and test units that emit alerts but
# whose cook sessions never land in the analytics table. In the real warehouse
# these were alerts carrying a cook_id with no matching cook session. They are
# the reason the broken model could exceed 100%.
ORPHAN_ALERTS_PER_WEEK = 900


def s_curve(week):
    """Fleet size at a given week — logistic growth, launch to saturation."""
    k = 0.130
    midpoint = 48.0
    return FLEET_MAX / (1.0 + math.exp(-k * (week - midpoint)))


def season(week, phase=0.0):
    """+1 at peak season, -1 at trough. Week 0 is early January."""
    return math.sin(2 * math.pi * (week / 52.0) + phase - math.pi / 2)


def base_rate(cat, week):
    """True percent of cooks affected, before noise. This is the signal."""
    if cat == "COMP_A":
        # Elevated and slowly worsening as early-build units accumulate hours,
        # then a long taper once the revised component reaches the field.
        if week < INTERVENTION_WEEK:
            return 3.9 + 0.022 * week
        decay = math.exp(-(week - INTERVENTION_WEEK) / 21.0)
        floor = 0.95
        return floor + (5.2 - floor) * decay
    if cat == "COMP_B":
        # Cold weather makes hard starts more likely.
        return 2.05 - 0.42 * season(week)
    if cat == "COMP_C":
        # Hot ambient + long summer cooks.
        return 1.25 + 0.30 * season(week)
    if cat == "COMP_D":
        return 0.34 + 0.0008 * week
    if cat == "COMP_E":
        return 0.29
    raise ValueError(cat)


def build_fleet():
    """Weekly fleet size, cook volume and the true per-category rates."""
    weeks = []
    for w in range(WEEKS):
        devices = s_curve(w)
        # Cooks per active device per week, seasonal. Winter ~0.55, summer ~1.5.
        per_device = 1.02 + 0.46 * season(w)
        # Only a fraction of registered devices cook in any given week.
        engaged = 0.42 + 0.10 * season(w)
        total_cooks = int(devices * engaged * per_device)
        weeks.append({
            "week": w,
            "date": (START + dt.timedelta(weeks=w)).isoformat(),
            "devices": int(devices),
            "total_cooks": max(total_cooks, 12),
        })
    return weeks


def true_trends(fleet):
    """The corrected model: numerator and denominator share a week anchor."""
    rows = []
    for f in fleet:
        n = f["total_cooks"]
        for cat in CATEGORIES:
            rate = base_rate(cat, f["week"])
            # Sampling noise shrinks as the denominator grows — small early
            # weeks are genuinely jumpy, and the chart should show that.
            sigma = max(0.02, rate * 0.09 + 3.0 / math.sqrt(n))
            observed = max(0.0, RNG.gauss(rate, sigma))
            cooks_with_error = int(round(n * observed / 100.0))
            rows.append({
                "week": f["week"],
                "date": f["date"],
                "category": cat,
                "cooks_with_error": cooks_with_error,
                "total_cooks": n,
                "rate": round(100.0 * cooks_with_error / n, 3),
            })
    return rows


def broken_trends(fleet, true_rows):
    """Reproduce the first version of the model, bug and all.

    Two mechanisms, both real:

      (a) SPLIT ANCHOR. The denominator counted cooks by the cook's start
          time; the numerator counted them by the alert's observed_at time. A
          cook starting Sunday night and erroring Monday morning lands in
          week N on one side and week N+1 on the other. On its own this is
          just a smear, and it is easy to miss.

      (b) ORPHAN ALERTS. Alerts carrying a cook_id with no matching cook
          session were counted in the numerator but had no denominator at all.
          Against the tiny cook volume of the launch weeks, a constant trickle
          of these is enough to push the rate past 1000%.

    (b) is what makes the chart absurd; (a) is what makes it subtly wrong
    everywhere else.
    """
    by_week = {}
    for r in true_rows:
        by_week.setdefault((r["week"], r["category"]), r)

    # Share of orphan alerts landing in each category, proportional to how
    # common the category is overall.
    weight_total = sum(base_rate(c, WEEKS - 1) for c in CATEGORIES)
    weights = {c: base_rate(c, WEEKS - 1) / weight_total for c in CATEGORIES}

    rows = []
    for f in fleet:
        w, n = f["week"], f["total_cooks"]
        for cat in CATEGORIES:
            here = by_week[(w, cat)]["cooks_with_error"]
            prev = by_week.get((w - 1, cat), {}).get("cooks_with_error", 0)

            # (a) 22% of last week's error cooks spill forward across the
            #     week boundary; 22% of this week's spill out of it.
            spill = 0.22
            numerator = here * (1 - spill) + prev * spill

            # (b) orphans, split across categories.
            numerator += ORPHAN_ALERTS_PER_WEEK * weights[cat]

            rows.append({
                "week": w,
                "date": f["date"],
                "category": cat,
                "cooks_with_error": int(round(numerator)),
                "total_cooks": n,
                "rate": round(100.0 * numerator / n, 2),
            })
    return rows


def week_anchor_examples():
    """A handful of cooks around one week boundary, for the root-cause step.

    Each row is a cook with a start time and the time its alert fired. Where
    those fall in different ISO weeks, the two halves of the rate calculation
    disagree about which bucket the cook belongs to.
    """
    # Postgres date_trunc('week') starts weeks on Monday, so the boundary that
    # matters is Sunday night into Monday morning — exactly when a long cook is
    # most likely to be running.
    boundary = dt.datetime(2025, 3, 3, 0, 0)   # a Monday, 00:00
    rows = []
    specs = [
        # (hours before/after boundary that the cook starts, cook length hrs,
        #  hours after cook start that the alert fires, category)
        (-7.5, 9.0, 8.2, "COMP_A"),        # straddles: starts Sat, errors Sun
        (-3.2, 5.5, 4.1, "COMP_B"),    # straddles
        (-22.0, 3.0, 1.4, "COMP_D"),       # clean, both sides in week N
        (-46.0, 4.5, 2.2, "COMP_A"),       # clean
        (-1.1, 7.0, 3.6, "COMP_C"),  # straddles
        (2.5, 6.0, 5.1, "COMP_A"),         # clean, both in week N+1
        (14.0, 2.5, 0.8, "COMP_E"),      # clean
        (-9.0, 11.0, 10.4, "COMP_B"),  # straddles — an overnight brisket
        (30.0, 3.5, 2.9, "COMP_A"),        # clean
        (-0.4, 4.0, 1.9, "COMP_D"),        # straddles by minutes
    ]
    for i, (offset_h, length_h, alert_h, cat) in enumerate(specs):
        start = boundary + dt.timedelta(hours=offset_h)
        alert = start + dt.timedelta(hours=alert_h)
        rows.append({
            "cook": "cook_%04d" % (4100 + i * 7),
            "start": start.isoformat(timespec="minutes"),
            "end": (start + dt.timedelta(hours=length_h)).isoformat(timespec="minutes"),
            "alert": alert.isoformat(timespec="minutes"),
            "category": cat,
            "start_week": start.isocalendar()[1],
            "alert_week": alert.isocalendar()[1],
            "straddles": start.isocalendar()[1] != alert.isocalendar()[1],
        })
    return {
        "boundary": boundary.isoformat(timespec="minutes"),
        "note": "Synthetic cooks around one week boundary. Illustrates why two "
                "different time anchors put the same cook in two buckets.",
        "rows": rows,
    }


def churn():
    """Device-level churn attribution over the synthetic fleet.

    Definitions match the real model exactly — those are methodology, not data:
      active   = 5+ lifetime cooks
      churned  = active and silent for 8+ weeks
      attributed = a qualifying hardware error inside the last 5 cooks before
                   going silent, with component B errors excused when a pellet-level
                   warning fired on the same cook
    """
    fleet = FLEET_MAX

    # Hazard of each category showing up in a churned device's final five
    # cooks. Ordering is the finding; the values are invented.
    hazard = {
        "COMP_A":       0.0245,
        "COMP_B":   0.0185,
        "COMP_C": 0.0110,
        "COMP_D":       0.0041,
        "COMP_E":     0.0027,
    }

    active = 0
    churned = 0
    attributed = {c: 0 for c in CATEGORIES}
    # Devices that hit a component B error on the same cook as a pellet-level
    # warning. The real model excludes these: the grill did not fail, it ran
    # out of fuel. Tracking the count makes the exclusion visible.
    excused_fuel_out = 0
    silent_weeks_hist = [0] * 27

    for _ in range(fleet):
        # Lifetime cooks: heavily right-skewed. Plenty of grills get unboxed,
        # used twice and forgotten.
        cooks = int(math.floor(RNG.lognormvariate(2.55, 1.15)))
        if cooks < 5:
            continue
        active += 1

        # Weeks since last cook. Most devices are in regular use; a long tail
        # has gone quiet, some seasonally and some for good.
        if RNG.random() < 0.70:
            silent = RNG.random() * 7.9              # still in use
        else:
            silent = 8 + RNG.expovariate(1 / 14.0)   # gone quiet
        bucket = min(26, int(silent // 2))
        silent_weeks_hist[bucket] += 1

        if silent < 8:
            continue
        churned += 1

        # More cooks means more exposure, so more chance a hardware error
        # appears in the final window.
        exposure = min(2.2, 0.55 + math.log1p(cooks) / 3.4)
        hits = [c for c in CATEGORIES if RNG.random() < hazard[c] * exposure]
        if not hits:
            continue
        # A device can log more than one kind of error in its final five cooks.
        # Attribute to one of them at random rather than to whichever category
        # happens to come first in the list — otherwise the ranking would be an
        # artefact of iteration order.
        hit = RNG.choice(hits)
        if hit == "COMP_B" and RNG.random() < 0.34:
            excused_fuel_out += 1     # out of pellets, not a failed part
            continue
        attributed[hit] += 1

    total_attributed = sum(attributed.values())
    return {
        "meta": {
            "synthetic": True,
            "seed": SEED,
            "note": "Definitions are the real ones; every count is generated.",
        },
        "funnel": [
            {"stage": "Connected devices", "value": fleet,
             "detail": "Four SKUs in the product family"},
            {"stage": "Active (5+ lifetime cooks)", "value": active,
             "detail": "Filters out registered-but-barely-used units"},
            {"stage": "Churned (8+ weeks silent)", "value": churned,
             "detail": "Long enough to survive vacations and the off season"},
            {"stage": "Error-attributed churn", "value": total_attributed,
             "detail": "Hardware error inside the last five cooks"},
        ],
        "attribution": [
            {"category": c, "label": LABELS[c], "devices": attributed[c],
             "share": round(100.0 * attributed[c] / total_attributed, 1)}
            for c in sorted(CATEGORIES, key=lambda c: -attributed[c])
        ],
        "excused_fuel_out": excused_fuel_out,
        "rates": {
            "active_of_fleet": round(100.0 * active / fleet, 1),
            "churn_of_active": round(100.0 * churned / active, 1),
            "attributed_of_churned": round(100.0 * total_attributed / churned, 1),
        },
        "silent_weeks_hist": [
            {"weeks": i * 2, "devices": v} for i, v in enumerate(silent_weeks_hist)
        ],
    }


def write(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))


def main():
    os.makedirs(OUT, exist_ok=True)

    fleet = build_fleet()
    true_rows = true_trends(fleet)
    broken_rows = broken_trends(fleet, true_rows)
    ch = churn()

    meta = {
        "synthetic": True,
        "seed": SEED,
        "weeks": WEEKS,
        "intervention_week": INTERVENTION_WEEK,
        "intervention_date": (START + dt.timedelta(weeks=INTERVENTION_WEEK)).isoformat(),
        "intervention_label": "Component revision enters production",
        "categories": [{"key": c, "label": LABELS[c]} for c in CATEGORIES],
    }

    write(os.path.join(OUT, "fleet.json"), {"meta": meta, "rows": fleet})
    write(os.path.join(OUT, "trends.json"), {"meta": meta, "rows": true_rows})
    write(os.path.join(OUT, "trends_broken.json"), {
        "meta": dict(meta, note="First version of the model. Split week anchor "
                                "plus orphan alerts with no matching cook."),
        "rows": broken_rows,
    })
    write(os.path.join(OUT, "week_anchor.json"), week_anchor_examples())
    write(os.path.join(OUT, "churn.json"), ch)

    worst = max(broken_rows, key=lambda r: r["rate"])
    print("woodridge: %d weeks, fleet %s -> %s devices"
          % (WEEKS, f"{fleet[0]['devices']:,}", f"{fleet[-1]['devices']:,}"))
    print("  broken model peaks at %.0f%% (week %d, %s, denominator %d cooks)"
          % (worst["rate"], worst["week"], worst["category"], worst["total_cooks"]))
    print("  corrected model max rate: %.2f%%"
          % max(r["rate"] for r in true_rows))
    print("  active %s / churned %s / attributed %s (%.1f%% of churned)"
          % (f"{ch['funnel'][1]['value']:,}", f"{ch['funnel'][2]['value']:,}",
             f"{ch['funnel'][3]['value']:,}", ch["rates"]["attributed_of_churned"]))
    for a in ch["attribution"]:
        print("    %-18s %5d  (%4.1f%%)" % (a["label"], a["devices"], a["share"]))


if __name__ == "__main__":
    main()
