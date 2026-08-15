#!/usr/bin/env python3
"""
parse_serato.py — turn a Serato history folder into the JSON the DJ case study reads.

This is the one script in this folder that is a parser, not a generator: the
music project runs on real data.

WHY IT EXISTS
-------------
Serato's History panel will export a CSV per session, but the CSV drops rows —
short plays, second loads of the same track — and you have to click through one
session at a time. The binary `.session` files in `_Serato_/History/Sessions/`
have everything: every load, both decks, exact start and end times, BPM and key
as Serato analysed them.

THE FILE FORMAT
---------------
Undocumented but simple, and the same container Serato uses for crates:

    [4-byte ASCII tag][4-byte big-endian length][payload]

repeated to EOF. A session is a `vrsn` header followed by one `oent` chunk per
play; each `oent` holds one `adat` chunk; each `adat` is the same tag/length
structure again, except the "tag" is a big-endian uint32 field id. Strings are
UTF-16BE, numbers are big-endian uint32 or a single byte. Field ids were
recovered by dumping every field across the library and cross-checking the
values against Serato's own CSV exports for four sessions where both exist —
see FIELDS below.

PRIVACY
-------
Field 2 is the absolute path of the audio file, so it contains a home directory
and, for anyone using a NAS, a network path. It is read (to tell local files
from streamed ones) and then dropped. It never reaches the output, and the raw
`_Serato_` folder is not committed.

Usage:
    python3 parse_serato.py [--input PATH] [--featured SESSION_ID]

    --input     path to a copy of the _Serato_ folder
                (default: ../../../dj-data/serato)
    --featured  session id to feature in the case study; by default the script
                picks the longest set with good key coverage.

Out: ../dj/{library,sets,featured,stats}.json
"""

import argparse
import collections
import datetime as dt
import glob
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INPUT = os.path.normpath(os.path.join(HERE, "..", "..", "..", "dj-data", "serato"))
OUT = os.path.join(HERE, "..", "dj")

# Field ids inside an `adat` chunk. Types matter: a two-character key like "Dm"
# and a uint32 are both four bytes, so length alone cannot tell them apart.
U32 = {1: "row", 15: "bpm", 28: "start", 29: "end", 31: "deck",
       45: "playtime", 48: "session", 53: "updated"}
STR = {6: "title", 7: "artist", 8: "album", 9: "genre", 23: "year",
       51: "key", 63: "device"}
PATH_FIELD = 2          # read, then discarded — see PRIVACY above

# A play shorter than this is a load, a preview or a mistake, not a play.
MIN_PLAY_S = 45
# Serato keeps one "session" open until you quit the app, so a session can span
# a whole weekend. A real set is a contiguous block of play; this long between
# the start of one track and the start of the next ends it. Measuring
# start-to-start rather than end-to-start is deliberate: a deck left running
# after everyone has gone home reports an enormous playtime, and using it would
# hide exactly the gap we are trying to find.
SET_GAP_S = 30 * 60
# Longest play credited to a single track when measuring how long a set ran.
MAX_TAIL_S = 12 * 60
# What counts as a set worth analysing.
MIN_SET_TRACKS = 15
MIN_SET_MINUTES = 45

# --- Camelot -----------------------------------------------------------------
# The Camelot wheel renumbers the circle of fifths so that compatible keys are
# neighbours: same number = relative major/minor, ±1 = a fifth away.
CAMELOT = {
    # minor -> nA
    "ABM": "1A", "G#M": "1A", "EBM": "2A", "D#M": "2A", "BBM": "3A", "A#M": "3A",
    "FM": "4A", "CM": "5A", "GM": "6A", "DM": "7A", "AM": "8A", "EM": "9A",
    "BM": "10A", "F#M": "11A", "GBM": "11A", "C#M": "12A", "DBM": "12A",
    # major -> nB
    "B": "1B", "F#": "2B", "GB": "2B", "DB": "3B", "C#": "3B", "AB": "4B",
    "G#": "4B", "EB": "5B", "D#": "5B", "BB": "6B", "A#": "6B", "F": "7B",
    "C": "8B", "G": "9B", "D": "10B", "A": "11B", "E": "12B",
}
# Serato will also hand back Camelot or Open Key notation depending on settings.
OPEN_KEY = {}
for _n in range(1, 13):
    OPEN_KEY["%dM" % _n] = "%dB" % (((_n + 6) % 12) + 1)
    OPEN_KEY["%dD" % _n] = "%dA" % (((_n + 6) % 12) + 1)


def to_camelot(raw):
    """Normalise whatever notation Serato reports into Camelot, or None."""
    if not raw:
        return None
    k = raw.strip().upper().replace("♯", "#").replace("♭", "B").replace(" ", "")
    if not k:
        return None
    # Already Camelot?
    if len(k) <= 3 and k[-1] in "AB" and k[:-1].isdigit():
        n = int(k[:-1])
        if 1 <= n <= 12:
            return k
    if k in OPEN_KEY:
        return OPEN_KEY[k]
    # "Dmin" / "D min" / "Dminor" -> "Dm"; "Dmaj" -> "D"
    for suffix in ("MINOR", "MIN"):
        if k.endswith(suffix):
            k = k[: -len(suffix)] + "M"
            break
    for suffix in ("MAJOR", "MAJ"):
        if k.endswith(suffix):
            k = k[: -len(suffix)]
            break
    return CAMELOT.get(k)


def camelot_parts(c):
    return (int(c[:-1]), c[-1]) if c else (None, None)


def move_type(a, b):
    """Classify one transition between two Camelot keys.

    The names are the ones DJs actually use. "Clash" is not a criticism — a
    deliberate key jump is a tool — but it is a different move from a mix that
    stays inside the wheel.
    """
    if not a or not b:
        return None
    if a == b:
        return "same"
    na, la = camelot_parts(a)
    nb, lb = camelot_parts(b)
    if na == nb:
        return "relative"                 # major <-> minor, same tonic
    step = (nb - na) % 12
    if la == lb and step in (1, 11):
        return "adjacent"                 # a fifth up or down
    if la == lb and step == 2:
            return "energy"               # +2 on the wheel, a lift
    return "clash"


COMPATIBLE = {"same", "adjacent", "relative", "energy"}


# --- binary reader -----------------------------------------------------------

def chunks(buf):
    """Walk [tag][len][payload] triples."""
    i, n = 0, len(buf)
    while i + 8 <= n:
        tag = buf[i:i + 4]
        length = struct.unpack(">I", buf[i + 4:i + 8])[0]
        if i + 8 + length > n:
            break                          # truncated tail; take what we have
        yield tag, buf[i + 8:i + 8 + length]
        i += 8 + length


def decode_str(raw):
    try:
        return raw.decode("utf-16-be").replace("\x00", "").strip()
    except UnicodeDecodeError:
        return None


def read_session(path):
    """Every play in one .session file."""
    try:
        buf = open(path, "rb").read()
    except OSError:
        return []
    plays = []
    for tag, body in chunks(buf):
        if tag != b"oent":
            continue
        for tag2, adat in chunks(body):
            if tag2 != b"adat":
                continue
            rec = {}
            local = False
            for ftag, fbuf in chunks(adat):
                fid = struct.unpack(">I", ftag)[0]
                if fid == PATH_FIELD:
                    p = decode_str(fbuf) or ""
                    # Local files carry an absolute path; streamed tracks carry
                    # a service handle instead (Tidal writes "_<id>.tdl"). The
                    # path is dropped either way — only this flag survives.
                    local = p.startswith("/")
                elif fid in U32 and len(fbuf) == 4:
                    rec[U32[fid]] = struct.unpack(">I", fbuf)[0]
                elif fid in STR:
                    rec[STR[fid]] = decode_str(fbuf)
            if rec.get("title"):
                rec["local"] = local
                plays.append(rec)
    return plays


# --- shaping -----------------------------------------------------------------

def clean(plays):
    """Drop non-plays and collapse the double-load artefact.

    Loading the same track onto the other deck to beatmatch writes a second
    row with the same title seconds later. Counting both would inflate every
    play count and invent a transition that never happened.
    """
    out = []
    for p in sorted(plays, key=lambda r: r.get("start", 0)):
        if not p.get("start") or p.get("playtime", 0) < MIN_PLAY_S:
            continue
        if out:
            prev = out[-1]
            same_track = (prev["title"], prev.get("artist")) == (p["title"], p.get("artist"))
            if same_track and p["start"] - prev["start"] < 240:
                # Keep whichever load actually got the airtime.
                if p.get("playtime", 0) > prev.get("playtime", 0):
                    out[-1] = p
                continue
        out.append(p)
    return out


def track_key(p):
    return ((p.get("artist") or "").strip().lower(), p["title"].strip().lower())


def split_on_gaps(plays):
    """Break a session into contiguous blocks of play.

    Leaving Serato running overnight is one session to Serato and two sets to
    everyone else. Without this the 'energy arc' of a set is mostly the shape
    of when the laptop was open.
    """
    blocks, cur = [], []
    for p in plays:
        if cur:
            prev = cur[-1]
            if p["start"] - prev["start"] > SET_GAP_S:
                blocks.append(cur)
                cur = []
        cur.append(p)
    if cur:
        blocks.append(cur)
    return blocks


def build_sets(all_plays):
    """Group plays into sessions, split those into sets, keep the real ones."""
    by_session = collections.defaultdict(list)
    for p in all_plays:
        by_session[p.get("session", 0)].append(p)

    blocks = []
    for sid, plays in sorted(by_session.items()):
        for part, block in enumerate(split_on_gaps(clean(plays)), start=1):
            blocks.append(("%d-%d" % (sid, part), block))

    sets = []
    for sid, plays in blocks:
        if len(plays) < MIN_SET_TRACKS:
            continue
        t0 = plays[0]["start"]
        t_end = max(p["start"] + min(p.get("playtime", 0), MAX_TAIL_S)
                    for p in plays)
        minutes = (t_end - t0) / 60.0
        if minutes < MIN_SET_MINUTES:
            continue

        tracks = []
        for i, p in enumerate(plays):
            cam = to_camelot(p.get("key"))
            tracks.append({
                "i": i,
                "t": round((p["start"] - t0) / 60.0, 2),      # minutes into the set
                "mins": round(p.get("playtime", 0) / 60.0, 2),
                "title": p["title"],
                "artist": p.get("artist") or "",
                "bpm": p.get("bpm") or None,
                "key": p.get("key") or None,
                "camelot": cam,
                "deck": p.get("deck"),
                "streamed": not p.get("local", False),
            })

        keyed = [t for t in tracks if t["camelot"]]
        bpms = [t["bpm"] for t in tracks if t["bpm"]]
        sets.append({
            "id": sid,
            "t0": t0,                    # epoch of the first play; internal only
            "date": dt.datetime.fromtimestamp(t0).date().isoformat(),
            "start": dt.datetime.fromtimestamp(t0).strftime("%H:%M"),
            "end": dt.datetime.fromtimestamp(t_end).strftime("%H:%M"),
            "minutes": round(minutes, 1),
            "tracks": tracks,
            "n": len(tracks),
            "key_coverage": round(len(keyed) / len(tracks), 3),
            "bpm_median": sorted(bpms)[len(bpms) // 2] if bpms else None,
            "device": next((p.get("device") for p in plays if p.get("device")), None),
        })
    sets.sort(key=lambda s: s["date"])
    return sets


def transitions(tracks):
    """Consecutive pairs, with the harmonic move and the tempo change."""
    out = []
    for a, b in zip(tracks, tracks[1:]):
        mv = move_type(a["camelot"], b["camelot"])
        d = (b["bpm"] - a["bpm"]) if (a["bpm"] and b["bpm"]) else None
        out.append({
            "from": a["camelot"], "to": b["camelot"],
            "from_i": a["i"], "to_i": b["i"],
            "move": mv,
            "bpm_delta": d,
        })
    return out


def longest_run(trs):
    """Longest unbroken stretch of harmonically compatible mixes."""
    best = cur = 0
    for t in trs:
        if t["move"] in COMPATIBLE:
            cur += 1
            best = max(best, cur)
        elif t["move"] is not None:
            cur = 0
    return best


def build_library(all_plays):
    lib = {}
    for p in all_plays:
        k = track_key(p)
        e = lib.get(k)
        if not e:
            e = lib[k] = {
                "title": p["title"], "artist": p.get("artist") or "",
                "bpm": p.get("bpm") or None, "key": p.get("key") or None,
                "camelot": to_camelot(p.get("key")),
                "plays": 0, "minutes": 0.0,
                "first": p["start"], "last": p["start"],
                "streamed": not p.get("local", False),
            }
        e["plays"] += 1
        e["minutes"] += p.get("playtime", 0) / 60.0
        e["first"] = min(e["first"], p["start"])
        e["last"] = max(e["last"], p["start"])
        # Serato re-analyses a track the first time it hits a deck, so a later
        # play may carry BPM/key that an earlier one lacked.
        if not e["bpm"] and p.get("bpm"):
            e["bpm"] = p["bpm"]
        if not e["camelot"] and p.get("key"):
            e["key"] = p["key"]
            e["camelot"] = to_camelot(p["key"])
    rows = []
    for e in lib.values():
        rows.append({
            "title": e["title"], "artist": e["artist"],
            "bpm": e["bpm"], "key": e["key"], "camelot": e["camelot"],
            "plays": e["plays"], "minutes": round(e["minutes"], 1),
            "first": dt.datetime.fromtimestamp(e["first"]).date().isoformat(),
            "last": dt.datetime.fromtimestamp(e["last"]).date().isoformat(),
            "streamed": e["streamed"],
        })
    rows.sort(key=lambda r: (-r["plays"], r["artist"], r["title"]))
    return rows


def build_stats(library, sets, all_plays):
    keyed = [t for t in library if t["camelot"]]
    bpms = [t["bpm"] for t in library if t["bpm"]]

    camelot_counts = collections.Counter(t["camelot"] for t in keyed)
    wheel = []
    for n in range(1, 13):
        for letter in ("A", "B"):
            c = "%d%s" % (n, letter)
            wheel.append({"camelot": c, "tracks": camelot_counts.get(c, 0)})

    bpm_hist = collections.Counter()
    for b in bpms:
        if 60 <= b <= 200:
            bpm_hist[int(b // 4) * 4] += 1

    all_moves = collections.Counter()
    all_deltas = []
    matrix = collections.Counter()
    for s in sets:
        for tr in transitions(s["tracks"]):
            if tr["move"]:
                all_moves[tr["move"]] += 1
                matrix[(tr["from"], tr["to"])] += 1
            if tr["bpm_delta"] is not None:
                all_deltas.append(tr["bpm_delta"])

    move_total = sum(all_moves.values()) or 1
    within = sum(1 for d in all_deltas if abs(d) <= 2)
    within6 = sum(1 for d in all_deltas if abs(d) <= 6)

    by_year = collections.Counter()
    for p in all_plays:
        by_year[dt.datetime.fromtimestamp(p["start"]).year] += 1

    artists = collections.Counter()
    for t in library:
        if t["artist"]:
            artists[t["artist"]] += t["plays"]

    return {
        "meta": {
            "source": "Serato DJ Pro history (real data)",
            "generated_from": "%d sessions" % len(sets),
        },
        "totals": {
            "plays": len(all_plays),
            "unique_tracks": len(library),
            "sets": len(sets),
            "hours": round(sum(s["minutes"] for s in sets) / 60.0, 1),
            "first_date": min(s["date"] for s in sets) if sets else None,
            "last_date": max(s["date"] for s in sets) if sets else None,
            "key_coverage": round(len(keyed) / len(library), 3) if library else 0,
            "streamed_share": round(
                sum(1 for t in library if t["streamed"]) / len(library), 3) if library else 0,
        },
        "wheel": wheel,
        "bpm_hist": [{"bpm": b, "tracks": bpm_hist[b]} for b in sorted(bpm_hist)],
        "moves": [{"move": m, "count": c, "share": round(100.0 * c / move_total, 1)}
                  for m, c in all_moves.most_common()],
        "bpm_discipline": {
            "transitions": len(all_deltas),
            "within_2": within,
            "within_2_pct": round(100.0 * within / len(all_deltas), 1) if all_deltas else 0,
            "within_6": within6,
            "within_6_pct": round(100.0 * within6 / len(all_deltas), 1) if all_deltas else 0,
            "median_abs": sorted(abs(d) for d in all_deltas)[len(all_deltas) // 2] if all_deltas else 0,
        },
        "matrix": [{"from": a, "to": b, "count": c}
                   for (a, b), c in matrix.most_common(140)],
        "by_year": [{"year": y, "plays": by_year[y]} for y in sorted(by_year)],
        "top_artists": [{"artist": a, "plays": c} for a, c in artists.most_common(20)],
    }


# The set the case study walks through. Chosen by hand over the automatic pick
# below: it is a real four-hour New Year's Eve party, 93 tracks with 92% key
# coverage, and the data carries the story on its own — Auld Lang Syne starts at
# 23:57:41 and runs through the countdown without anyone having to annotate it.
# Pass --featured to use another.
FEATURED_DEFAULT = "2947-1"

# The two sets the case study compares. The history contains exactly two New
# Year's Eve parties, twelve months apart, and putting them side by side is the
# only controlled experiment in the whole dataset: same night of the year, same
# job, same room-sized audience, a year of practice in between. Pass --compare
# to use a different pair.
COMPARE_DEFAULT = ("2947-1", "6673-1")


def pick_featured(sets):
    """Fallback when FEATURED_DEFAULT is not in the data: long and well-keyed."""
    def score(s):
        return s["n"] * (0.4 + s["key_coverage"]) * min(1.6, s["minutes"] / 90.0)
    return max(sets, key=score) if sets else None


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else None


def next_midnight(t0):
    """The midnight this set is heading toward, as an epoch.

    For a New Year's Eve set the interesting origin is not when the set started,
    it is the countdown. Anchoring the x axis here is what lets two nights of
    different length share one axis: both cross zero at the same instant.
    """
    d = dt.datetime.fromtimestamp(t0)
    return dt.datetime.combine(d.date() + dt.timedelta(days=1), dt.time(0, 0)).timestamp()


def build_one(s):
    """One set, shaped for the comparison: tracks carry minutes-from-midnight."""
    mid = next_midnight(s["t0"])
    offset = (s["t0"] - mid) / 60.0          # negative: the set starts before midnight
    tracks = []
    for t in s["tracks"]:
        c = dict(t)
        c["m"] = round(offset + t["t"], 2)   # minutes relative to midnight
        tracks.append(c)

    trs = transitions(s["tracks"])
    deltas = [abs(t["bpm_delta"]) for t in trs if t["bpm_delta"] is not None]
    moves = collections.Counter(t["move"] for t in trs if t["move"])
    mv_total = sum(moves.values()) or 1
    bpms = [t["bpm"] for t in s["tracks"] if t["bpm"]]

    # The last record of the old year and the first of the new one. Found by
    # timestamp, never by title: hardcoding "auld lang syne" would break the
    # moment a different night got featured, and the point of the whole section
    # is that nothing in the pipeline knows what New Year's Eve is.
    before = [t for t in tracks if t["m"] < 0]
    after = [t for t in tracks if t["m"] >= 0]
    midnight = {
        "last_of_year": before[-1] if before else None,
        "first_of_year": after[0] if after else None,
    }

    return {
        "id": s["id"],
        "year": int(s["date"][:4]),
        "date": s["date"],
        "start": s["start"],
        "end": s["end"],
        "minutes": s["minutes"],
        "device": s["device"],
        "n": s["n"],
        "offset": round(offset, 2),
        "tracks": tracks,
        "transitions": trs,
        "midnight": midnight,
        "summary": {
            "tracks": s["n"],
            "minutes": s["minutes"],
            "key_coverage": s["key_coverage"],
            "bpm_median": s["bpm_median"],
            "bpm_range": [min(bpms), max(bpms)] if bpms else [None, None],
            "median_jump": median(deltas),
            "within_2_pct": round(100.0 * sum(1 for d in deltas if d <= 2) / len(deltas), 1) if deltas else 0,
            "within_6_pct": round(100.0 * sum(1 for d in deltas if d <= 6) / len(deltas), 1) if deltas else 0,
            "clash_pct": round(100.0 * moves.get("clash", 0) / mv_total, 1),
            "compatible_pct": round(100.0 * (mv_total - moves.get("clash", 0)) / mv_total, 1),
            "longest_harmonic_run": longest_run(trs),
            "streamed_pct": round(100.0 * sum(1 for t in s["tracks"] if t["streamed"]) / s["n"], 1),
            "moves": dict(moves),
        },
    }


# The paired numbers the comparison chart draws, in the order it draws them.
# `better` says which direction is an improvement *at the thing being measured*,
# or None where there is no better — a set is not worse for being shorter, and
# the whole argument of this page is that leaving the wheel is a choice rather
# than a mistake. `short` is what the chart uses when the viewport cannot afford
# the full label; carried here rather than truncated in JS so the abbreviation
# is a decision someone made rather than a string operation.
COMPARE_METRICS = [
    ("median_jump",  "Median tempo jump",         "Median jump", " BPM", "down"),
    ("within_2_pct", "Transitions within ±2 BPM", "Within ±2",   "%",    "up"),
    ("within_6_pct", "Transitions within ±6 BPM", "Within ±6",   "%",    "up"),
    ("clash_pct",    "Transitions off the wheel", "Off the wheel", "%",  None),
    ("key_coverage", "Tracks with a key",         "Keyed",       "%",    None),
    ("minutes",      "Length",                    "Length",      " min", None),
    ("tracks",       "Tracks played",             "Tracks",      "",     None),
]


def build_compare(sets, ids):
    picked = []
    for sid in ids:
        s = next((x for x in sets if x["id"] == sid), None)
        if s is None:
            sys.exit("No set with id %s. Available: %s"
                     % (sid, ", ".join(x["id"] for x in sets)))
        picked.append(build_one(s))
    picked.sort(key=lambda p: p["date"])

    metrics = []
    for key, label, short, unit, better in COMPARE_METRICS:
        vals = []
        for p in picked:
            v = p["summary"][key]
            if key == "key_coverage" and v is not None:
                v = round(100.0 * v, 1)          # stored as a fraction
            vals.append(v)
        metrics.append({"key": key, "label": label, "short": short,
                        "unit": unit, "better": better, "values": vals})

    return {
        "meta": {
            "source": "Serato DJ Pro history (real data)",
            "note": "The two New Year's Eve sets in the history, twelve months apart.",
            "ids": [p["id"] for p in picked],
            "years": [p["year"] for p in picked],
            # The axis both nights share, in minutes either side of midnight.
            "m_domain": [
                math.floor(min(t["m"] for p in picked for t in p["tracks"]) / 10) * 10,
                math.ceil(max(t["m"] for p in picked for t in p["tracks"]) / 10) * 10,
            ],
        },
        "sets": picked,
        "metrics": metrics,
    }


def write(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=DEFAULT_INPUT)
    ap.add_argument("--featured", default=None,
                    help="set id, e.g. 8717-1")
    ap.add_argument("--compare", default=None,
                    help="two set ids to compare, comma separated, "
                         "e.g. 2947-1,6673-1")
    args = ap.parse_args()

    session_dir = os.path.join(args.input, "History", "Sessions")
    files = sorted(glob.glob(os.path.join(session_dir, "*.session")))
    if not files:
        sys.exit("No .session files under %s\n"
                 "Copy your _Serato_ folder to dj-data/serato/ first — see "
                 "dj-data/README.md." % session_dir)

    raw = []
    for f in files:
        raw.extend(read_session(f))

    all_plays = clean(raw)
    library = build_library(all_plays)
    sets = build_sets(raw)

    featured = None
    if args.featured is not None:
        featured = next((s for s in sets if s["id"] == args.featured), None)
        if featured is None:
            sys.exit("No set with id %s. Available: %s"
                     % (args.featured, ", ".join(s["id"] for s in sets)))
    else:
        featured = next((s for s in sets if s["id"] == FEATURED_DEFAULT), None)
        if featured is None:
            featured = pick_featured(sets)

    compare_ids = ([s.strip() for s in args.compare.split(",")]
                   if args.compare else list(COMPARE_DEFAULT))
    have = {s["id"] for s in sets}
    compare = (build_compare(sets, compare_ids)
               if all(i in have for i in compare_ids) else None)
    if compare is None:
        print("  ! skipping compare.json — %s not in this history"
              % ", ".join(i for i in compare_ids if i not in have))

    stats = build_stats(library, sets, all_plays)

    os.makedirs(OUT, exist_ok=True)
    write(os.path.join(OUT, "library.json"), {
        "meta": {"source": "Serato DJ Pro history", "tracks": len(library)},
        "rows": library,
    })
    # Set index without the track arrays — the dashboard and the timeline only
    # need the summary, and this keeps the payload small.
    write(os.path.join(OUT, "sets.json"), {
        "meta": {"sets": len(sets)},
        "rows": [{k: v for k, v in s.items() if k not in ("tracks", "t0")}
                 for s in sets],
    })
    if compare:
        write(os.path.join(OUT, "compare.json"), compare)
    if featured:
        trs = transitions(featured["tracks"])
        write(os.path.join(OUT, "featured.json"), {
            "meta": {
                "id": featured["id"], "date": featured["date"],
                "start": featured["start"], "minutes": featured["minutes"],
                "device": featured["device"],
            },
            "tracks": featured["tracks"],
            "transitions": trs,
            "summary": {
                "tracks": featured["n"],
                "key_coverage": featured["key_coverage"],
                "longest_harmonic_run": longest_run(trs),
                "moves": dict(collections.Counter(
                    t["move"] for t in trs if t["move"])),
                "bpm_range": [min((t["bpm"] for t in featured["tracks"] if t["bpm"]), default=None),
                              max((t["bpm"] for t in featured["tracks"] if t["bpm"]), default=None)],
            },
        })
    write(os.path.join(OUT, "stats.json"), stats)

    t = stats["totals"]
    print("serato: %d plays, %d unique tracks, %d sets, %.0f hours (%s -> %s)"
          % (t["plays"], t["unique_tracks"], t["sets"], t["hours"],
             t["first_date"], t["last_date"]))
    print("  key coverage %.0f%%, streamed %.0f%%"
          % (100 * t["key_coverage"], 100 * t["streamed_share"]))
    print("  moves: " + ", ".join("%s %s%%" % (m["move"], m["share"]) for m in stats["moves"]))
    print("  BPM within +/-2 on %.0f%% of transitions"
          % stats["bpm_discipline"]["within_2_pct"])
    if featured:
        print("  featured set %s: %s, %d tracks, %.0f min, longest harmonic run %d"
              % (featured["id"], featured["date"], featured["n"], featured["minutes"],
                 longest_run(transitions(featured["tracks"]))))
    if compare:
        print("  compare: " + " vs ".join(
            "%s (%s, %d tracks)" % (p["year"], p["id"], p["n"])
            for p in compare["sets"]))
        for m in compare["metrics"]:
            print("    %-28s %s" % (m["label"], "  ->  ".join(
                "%s%s" % (v, m["unit"]) for v in m["values"])))


if __name__ == "__main__":
    main()
