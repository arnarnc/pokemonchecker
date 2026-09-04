#!/usr/bin/env python3
"""
Refresh cards_op.js -- the local One Piece TCG dataset behind the instant
autocomplete, the English printings only.

Source is Limitless (onepiece.limitlesstcg.com), which is the only public
One Piece catalogue that lists every PRINT of a card rather than every card:
OP01-016 Nami exists as a plain Rare, as an Alternate Art, and as a Manga Art,
and those three sell for wildly different money. A pricing app that can't tell
them apart is worse than useless, so the print -- not the card -- is the unit
this script stores.

    python scripts/fetch_op_cards.py               # every set
    python scripts/fetch_op_cards.py OP17 PRB01    # just these (quick re-check)

Each set is one HTML page (`?display=full&lang=en&show=all&unique=prints`),
so a full run is ~60 requests, not ~13,000.
"""
import json
import os
import re
import sys
import time
import urllib.request

BASE = "https://onepiece.limitlesstcg.com"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "cards_op.js")
UA = "Mozilla/5.0 (compatible; pawfect-pricing/1.0)"

# Limitless print labels -> the short code the app stores and the user types.
# The empty string is the standard print: no treatment, nothing to disambiguate.
# Base rarities (Common .. Secret Rare, Leader) are NOT treatments -- a card's
# number already implies its base rarity, so they map to "" and live in the
# rarity column instead.
BASE_RARITY = {
    "Common": "C",
    "Uncommon": "UC",
    "Rare": "R",
    "Super Rare": "SR",
    "Secret Rare": "SEC",
    "Leader": "L",
    "Promo": "P",
    "DON!!": "DON",
    "Don!!": "DON",
}
TREATMENT = {
    "Alternate Art": "AA",
    "Manga Art": "MANGA",
    "Full Art": "FA",
    "Special Card": "SP",
    "Treasure Rare": "TR",
    "Textured Foil": "TF",
    "Pirate Foil": "PF",
    "Serial": "SERIAL",
    "Serial Card": "SERIAL",
    "Winner Version": "WINNER",
    "Judge": "JR",
    "Wanted Poster": "WANTED",
    # Limitless ships a few style keys untranslated; they still identify a real
    # parallel, so they're mapped by key rather than dropped.
    "card.style.panda": "PAN",
    "card.style.wanted": "WANTED",
    "card.style.serial": "SERIAL",
}


def get(url, attempts=4):
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as e:
            wait = 4 * (attempt + 1)
            print(f"  {url} failed ({e}), retrying in {wait}s...")
            time.sleep(wait)
    print(f"  gave up on {url}")
    return ""


def unescape(s):
    return (s.replace("&#039;", "'").replace("&amp;", "&").replace("&quot;", '"')
             .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " "))


def text(html):
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", html)).split())


# ── Set index ──────────────────────────────────────────────────
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def parse_date(s):
    """'28 Aug 26' -> '2026-08-28', 'Sep 26' -> '2026-09'. Unparseable -> ''
    (which sorts last, exactly where an undated set belongs)."""
    s = s.strip()
    m = re.match(r"(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{2,4})", s)
    if m:
        day, mon, year = int(m.group(1)), MONTHS.get(m.group(2)[:3].title()), int(m.group(3))
        if mon:
            return f"{year + 2000 if year < 100 else year:04d}-{mon:02d}-{day:02d}"
    m = re.match(r"([A-Za-z]{3})\w*\s+(\d{2,4})$", s)
    if m:
        mon, year = MONTHS.get(m.group(1)[:3].title()), int(m.group(2))
        if mon:
            return f"{year + 2000 if year < 100 else year:04d}-{mon:02d}"
    return ""


def index_rows(path, code_col):
    """Set-index rows as (slug_or_code, name, release) from a /cards listing."""
    html = get(f"{BASE}{path}")
    main = re.search(r"<main>(.*)</main>", html, re.S)
    if not main:
        return []
    out = []
    for row in re.findall(r"<tr.*?</tr>", main.group(1), re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 3:
            continue
        if code_col:
            code, name, date = text(cells[0]), text(cells[1]), text(cells[2])
            if not re.match(r"^[A-Z]+\d*$", code):
                continue
        else:
            link = re.search(r'href="/cards/([^"]+)"', row)
            if not link:
                continue
            code, name, date = link.group(1), text(cells[0]), text(cells[1])
        out.append((code, name, parse_date(date)))
    return out


def fetch_sets():
    """Every fetchable set page, newest first.

    Two indexes, because Limitless splits them: /cards lists the numbered
    releases (OP##, ST##, EB##, PRB##), while /cards/promos is itself an index
    of ~85 promo *products* -- tournament packs, event packs, anniversary sets.
    Those matter more here than their card count suggests: SP cards (the
    gold-stamped tournament parallels) only exist there, and they are among the
    priciest English cards in the game.
    """
    return index_rows("/cards", True) + index_rows("/cards/promos", False)


# ── One set page -> print rows ─────────────────────────────────
def fetch_set(code):
    """Every English print in one set: (name, card_id, rarity, treatment)."""
    html = get(f"{BASE}/cards/{code}?display=full&lang=en&show=all&unique=prints")
    rows = []
    for block in html.split('class="card-profile"')[1:]:
        cid = re.search(r'card-text-id">(.*?)</span>', block, re.S)
        name = re.search(r'card-text-name">\s*<a[^>]*>(.*?)</a>', block, re.S)
        if not name:
            name = re.search(r'card-text-name">(.*?)</span>', block, re.S)
        cur = re.search(r'prints-current-details">(.*?)</div>', block, re.S)
        if not (cid and name and cur):
            continue
        spans = [text(s) for s in re.findall(r"<span[^>]*>(.*?)</span>", cur.group(1), re.S)]
        label = spans[1] if len(spans) > 1 else ""
        rows.append((text(name.group(1)), text(cid.group(1)),
                     BASE_RARITY.get(label, ""), TREATMENT.get(label, "")))
        if label and label not in BASE_RARITY and label not in TREATMENT:
            print(f"        ? unmapped print label {label!r} on {text(cid.group(1))}")
    return rows


def backfill_rarity(rows):
    """A parallel print's row carries its treatment, not its base rarity --
    Limitless labels it "Alternate Art", full stop. The plain print of the same
    card number knows the rarity, so lend it across: the dropdown can then say
    "SR · Alt Art" instead of just "Alt Art".

    Runs over the whole dataset rather than per set, because a promo product's
    alternate art is usually a reprint of a card whose plain print sits in a
    booster set fetched pages earlier.
    """
    by_id = {}
    for r in rows:
        if r[2] and not r[3]:
            by_id.setdefault(r[1], r[2])
    for r in rows:
        if not r[2]:
            r[2] = by_id.get(r[1], "")
    return rows


def write(rows):
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/fetch_op_cards.py -- do not hand-edit.\n")
        f.write(f"// Snapshot: {time.strftime('%Y-%m-%d')} | {len(rows)} English One Piece prints\n")
        f.write("// Row: [name, cardId, rarity, treatment, setName, releaseDate, nameLower, setCode]\n")
        f.write("const CARDS_OP_SNAPSHOT = " + json.dumps(time.strftime("%Y-%m-%d")) + ";\n")
        f.write("const CARDS_OP = " + json.dumps(rows, separators=(",", ":"), ensure_ascii=False) + ";\n")
    return os.path.getsize(OUT_PATH) / 1024


def main():
    wanted = [a.upper() for a in sys.argv[1:] if not a.startswith("--")]

    sets = fetch_sets()
    if not sets:
        print("Couldn't read the set list -- nothing written.")
        return 1
    if wanted:
        sets = [s for s in sets if s[0].upper() in wanted]
    print(f"{len(sets)} sets to fetch\n")

    out = []
    for i, (code, name, release) in enumerate(sets, 1):
        print(f"  [{i}/{len(sets)}] {code} {name} ({release or 'n/a'})")
        prints = fetch_set(code)
        # The set CODE, not just its name, so the app can tell an original
        # printing from a promo reprint of the same card number: OP01-016 in
        # "Romance Dawn" is the card that came in the OP01 packs, the identical
        # number in "Gift Collection 2023" is a reprint. Promo products have no
        # code of their own and store "".
        set_code = code.upper() if re.match(r"^[A-Z]+\d*$", code) else ""
        for (cname, cid, rar, treat) in prints:
            out.append([cname, cid, rar, treat, name, release, cname.lower(), set_code])
        print(f"        {len(prints)} prints")
        time.sleep(0.5)

    if not out:
        print("Nothing fetched -- leaving cards_op.js alone.")
        return 1

    backfill_rarity(out)
    # Newest set first, matching cards.js, so the freshest printings rank top.
    out.sort(key=lambda r: r[5], reverse=True)
    size_kb = write(out)
    print(f"\nWrote {os.path.normpath(OUT_PATH)} ({len(out)} prints, {size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
