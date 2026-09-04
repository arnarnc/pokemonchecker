// One Piece TCG: catalogue search, shorthand, and the eBay keyword string.
//
// The One Piece card game names a card differently from Pokemon, and the whole
// module follows from that one fact. A Pokemon card is pinned by "name +
// collector number" because the number ("125/197") is only unique inside its
// set. A One Piece card is pinned by its ID alone -- "OP01-016" carries the set
// (OP01) and the card (016) in one token, and no other card in the game shares
// it. The character name is decoration: typing "Nami OP01-016" on eBay can only
// ever return FEWER listings than "OP01-016", never more, because eBay ANDs
// every word. So the name is what you TYPE to find the card, and the ID is what
// gets SEARCHED.
//
// What the ID does not pin down is the printing, and that is where the money
// is. OP01-016 exists as a plain Rare (a couple of dollars), as an Alternate
// Art (hundreds), and as a Manga Art (thousands). One number, three cards, three
// prices. So this module treats the PRINT as the unit: the catalogue stores one
// row per printing, the dropdown lists them separately, and a short tag ("aa",
// "manga", "sp") is what tells eBay which one you are holding.
//
// Depends on cards_op.js (CARDS_OP). Standalone and side-effect free otherwise.

(function (root) {
  "use strict";

  // ── Print treatments ──────────────────────────────────────
  // Three columns, and they are deliberately not the same words:
  //
  //   code   what cards_op.js stores (from the Limitless print label)
  //   label  what the dropdown and the status badge show a human
  //   ebay   what actually goes into the eBay search box
  //   type   every shorthand that maps to this treatment
  //
  // The `ebay` column is the one to tune. eBay ANDs every word and has no
  // working OR (see the long note in index.html's buildUrls), so each entry is
  // ONE phrase and the only question is which phrase the most sellers used.
  // Where two spellings compete, the shorter, more common one wins: sellers
  // write "alt art" far more than "alternate art", and a listing titled
  // "Alternate Art" is missed either way if you guess wrong -- but guessing
  // "alt art" misses fewer. Single tokens ("manga", "serial", "pandaman") are
  // free of that problem entirely and are preferred wherever one exists.
  var TREATMENTS = [
    { code: "AA",     label: "Alt Art",      ebay: "alt art",     type: ["aa", "alt", "altart", "alternate"] },
    { code: "MANGA",  label: "Manga",        ebay: "manga",       type: ["manga", "mr", "comic"] },
    { code: "SP",     label: "SP",           ebay: "sp",          type: ["sp", "special"] },
    { code: "FA",     label: "Full Art",     ebay: "full art",    type: ["fa", "fullart"] },
    { code: "TR",     label: "Treasure",     ebay: "treasure",    type: ["tr", "treasure"] },
    { code: "PAN",    label: "Pandaman",     ebay: "pandaman",    type: ["pan", "panda", "pandaman"] },
    { code: "TF",     label: "Textured",     ebay: "textured",    type: ["tf", "textured"] },
    { code: "PF",     label: "Pirate Foil",  ebay: "pirate foil", type: ["pf", "pirate"] },
    { code: "SERIAL", label: "Serial",       ebay: "serial",      type: ["serial", "ser"] },
    { code: "WINNER", label: "Winner",       ebay: "winner",      type: ["winner", "win"] },
    { code: "JR",     label: "Judge",        ebay: "judge",       type: ["jr", "judge"] },
    { code: "WANTED", label: "Wanted",       ebay: "wanted",      type: ["wanted", "wp"] }
  ];

  // The plain printing is a treatment too, from the search's point of view:
  // "OP01-016" alone returns the alt art and the manga art alongside it, and
  // those sold for 100x the card you are holding. It is the one case that has
  // to be expressed as exclusions rather than a keyword, because the base print
  // is defined by what it ISN'T. Kept narrow on purpose -- "-art" would also
  // strike out any listing whose title happens to say "card art".
  var BASE = {
    code: "BASE", label: "Base Print", ebay: "-alt -manga -parallel -serial",
    type: ["base", "reg", "regular", "normal", "plain"]
  };

  // Language. English is the default and gets no keyword: most English listings
  // never say "english", so requiring the word would drop more real comps than
  // the Japanese listings it removes. Excluding the other language is the
  // higher-recall way to say the same thing.
  var LANGS = {
    en: "-japanese", eng: "-japanese", english: "-japanese",
    jp: "japanese", jpn: "japanese", japanese: "japanese"
  };

  // Sealed product shorthand. etb/bbx are already global in index.html; these
  // are the ones only One Piece has.
  var PRODUCTS = {
    sd: "starter deck", st: "starter deck", deck: "starter deck",
    dp: "double pack", case: "sealed case"
  };
  var SEALED_RE = /\b(booster box|bbx|starter deck|sd|sealed|case|display|carton|dp|double pack)\b/i;

  var BY_SHORTHAND = {};   // "aa" -> treatment
  var BY_CODE = {};        // "AA" -> treatment
  [BASE].concat(TREATMENTS).forEach(function (t) {
    BY_CODE[t.code] = t;
    t.type.forEach(function (s) { BY_SHORTHAND[s] = t; });
  });

  // Everything the parser recognises as "not part of a character's name".
  var GRADERS = /^(psa|bgs|cgc|sgc|tag|ace)$/;
  var CONDITIONS = /^(nm|lp|mp|hp|dmg|mint|near|lightly|moderately|heavily|played|damaged|raw|graded|sealed|gem)$/;

  // Collector-number canonicaliser, injected by index.html so "OP01-016" and
  // "op1-16" are one card here, in recents and in the saved-comp search alike.
  var canon = function (s) { return String(s == null ? "" : s).toLowerCase(); };
  function setCanon(fn) { if (typeof fn === "function") canon = fn; }

  // ── Card IDs ──────────────────────────────────────────────
  // "OP01-016", "ST21-001", "EB03-090", "PRB01-001", "P-001": a set family in
  // letters, a 2-digit set number, and a 3-digit card number. The separator and
  // the zero padding are both optional to type, so "op1-16", "op01 016" and
  // "op01016" all reach the same card.
  //
  // One digit run is the ambiguous case, and the set family settles it. Every
  // family but one numbers its sets -- OP01, ST21, EB03, PRB01 -- so a lone
  // "op17" is a SET, not a card. "P" is the exception: promos have no set
  // number, so "P-001" is a card. Getting this backwards is not a near miss;
  // it turns "op17 booster box" into a search for the card OP01-007.
  var CODE_RE = /^([a-z]{1,4})[-\s]?(\d{1,5})(?:[-\s](\d{1,4}))?$/i;
  var PROMO_FAMILY = /^p$/i;

  function pad(n, w) { n = String(n || ""); return n.length >= w ? n : "0000".slice(0, w - n.length) + n; }

  // { family, set, card } for anything ID-shaped, else null. `card` is "" for a
  // bare set code, which is what a sealed-product search is asking about.
  function splitCode(tok) {
    var m = CODE_RE.exec(String(tok || ""));
    if (!m) return null;
    var family = m[1].toUpperCase();
    if (m[3]) return { family: family, set: m[2], card: m[3] };
    if (PROMO_FAMILY.test(family)) return { family: family, set: "", card: m[2] };
    // No separator and enough digits to hold both halves: "op01016".
    if (m[2].length >= 4) return { family: family, set: m[2].slice(0, 2), card: m[2].slice(2) };
    return { family: family, set: m[2], card: "" };
  }

  function looksLikeCode(tok) { return !!splitCode(tok); }

  // Printed form, which is also the form eBay sellers put in their titles.
  function canonCode(tok) {
    var p = splitCode(tok);
    if (!p) return String(tok || "").toUpperCase();
    if (!p.card) return p.family + pad(p.set, 2);
    return p.family + (p.set ? pad(p.set, 2) : "") + "-" + pad(p.card, 3);
  }

  // Comparison form: letters and digits only, so a typed fragment can be
  // prefix-matched against a full ID without the dash getting in the way.
  function looseCode(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // The shapes a typed fragment might have been aiming at: as typed, and
  // zero-padded the way the card is printed. "op1-16" only reaches OP01-016
  // through the padded form; a half-typed "op01-0" only through the raw one.
  function codeKeys(tok) {
    var keys = [looseCode(tok)];
    var p = splitCode(tok);
    if (p && p.card) {
      [p.family + pad(p.set, 2) + pad(p.card, 3),
       p.family + pad(p.set, 2) + p.card].forEach(function (v) {
        v = looseCode(v);
        if (v && keys.indexOf(v) === -1) keys.push(v);
      });
    }
    return keys.filter(Boolean);
  }

  // ── Query parsing ─────────────────────────────────────────
  // Turns whatever was typed into the parts that mean something:
  //
  //   "PSA 10 Nami OP01-016 aa nm"
  //     -> code "OP01-016", treatment AA, name ["nami"],
  //        extras ["psa","10","nm"], nameEnd 3
  //
  // Never throws. A query it cannot make sense of comes back as name words and
  // no code, which is exactly what a free-text eBay search should be.
  function parseQuery(raw) {
    var tokens = String(raw == null ? "" : raw)
      .toLowerCase().replace(/[.,#]/g, " ")
      // "op01 016" is one card ID typed with a space, not a set code followed
      // by a stray number. Rejoin it before tokenising or the two halves are
      // parsed as unrelated things and the search loses the card entirely.
      .replace(/\b([a-z]{1,4}\d{1,2})\s+(\d{1,3})\b/g, "$1-$2")
      .split(/\s+/).filter(Boolean);
    var out = { code: "", codeRaw: "", treat: null, lang: "", name: [], nameAt: [],
                extras: [], codeAt: -1, sealed: false, setCode: "" };

    tokens.forEach(function (tok, i) {
      if (BY_SHORTHAND[tok] && !(tok === "sd" || tok === "st")) {
        // A treatment tag. "sp" is both a treatment and nothing else, so it is
        // safe; "sd"/"st" are product words and are handled below.
        if (!out.treat) out.treat = BY_SHORTHAND[tok];
        return;
      }
      if (LANGS[tok]) { out.lang = out.lang || LANGS[tok]; return; }
      if (PRODUCTS[tok]) { out.sealed = true; out.extras.push(PRODUCTS[tok]); return; }
      var split = splitCode(tok);
      if (split) {
        // A full ID pins the card; a bare set code ("OP17") only pins the set,
        // which is what a sealed-product search is asking about. codeRaw keeps
        // the fragment as typed, because a half-finished ID still has to
        // prefix-match the catalogue while canonCode has already padded it out.
        if (split.card && !out.code) {
          out.code = canonCode(tok); out.codeRaw = tok; out.codeAt = i; return;
        }
        if (!split.card && !out.setCode) { out.setCode = canonCode(tok); return; }
      }
      if (GRADERS.test(tok) || CONDITIONS.test(tok) || /\d/.test(tok)) { out.extras.push(tok); return; }
      out.name.push(tok); out.nameAt.push(i);
    });

    if (SEALED_RE.test(String(raw || ""))) out.sealed = true;
    return out;
  }

  // What recents and the saved-comp search need: the same {name, number, total}
  // shape index.html's Pokemon parser returns, so one matcher serves both games.
  // The card ID plays the part of the collector number.
  function parseForRecents(raw) {
    var p = parseQuery(raw);
    return { name: p.name.join(" "), number: canon(p.code || p.setCode || ""), total: "" };
  }

  // ── eBay keyword string ───────────────────────────────────
  // The rule this whole module exists to apply: once a card ID is present, the
  // character name is dropped, because it can only narrow a search that is
  // already exact. Only names typed BEFORE the ID go -- that is where a name
  // goes, and it keeps any word typed after the ID (a treatment eBay spells
  // differently, "1st edition", whatever) working as a plain extra keyword.
  //
  // With no ID, nothing is dropped and the input is passed through verbatim:
  // a sealed-product or free-text search is the user's own wording, and this
  // module has no business rewriting it.
  function buildQuery(raw) {
    var p = parseQuery(raw);

    // Sealed: a set code means the set's NAME, because that is how boxes are
    // titled. Nobody lists "OP17 booster box"; they list "The World's Strongest
    // Warriors Booster Box".
    if (p.sealed && !p.code) {
      var setName = p.setCode ? setNameFor(p.setCode) : "";
      if (!setName) return String(raw || "");
      // p.name is product wording here ("bbx", "booster", "box"), not a
      // character -- there is no card ID for it to be redundant against, so it
      // is kept and left for index.html's expandProducts to spell out.
      return ["one piece", setName].concat(p.extras, p.name).join(" ").trim();
    }

    if (!p.code) return String(raw || "");

    var parts = [];
    // A promo ID is just "P-001": two tokens, neither distinctive, which on its
    // own returns half of eBay. Only that shape needs the game name bolted on.
    if (/^[A-Z]+-/.test(p.code) && !/\d/.test(p.code.split("-")[0])) parts.push("one piece");
    parts.push(p.code);
    if (p.treat) parts.push(p.treat.ebay);
    if (p.lang) parts.push(p.lang);
    // Extras keep their typed order; name words typed after the ID are kept too,
    // since the drop rule only covers the ones in front of it.
    parts = parts.concat(p.extras);
    p.name.forEach(function (w, i) { if (p.nameAt[i] > p.codeAt) parts.push(w); });
    // Deduped because a shorthand and its spelled-out form often overlap:
    // "op01-016 alt art" expands "alt" to "alt art" and would otherwise leave a
    // stray second "art" in the query. eBay ANDs repeats, so a duplicate word
    // costs nothing to remove and would cost recall to leave in.
    var seen = {};
    return parts.join(" ").split(/\s+/)
      .filter(function (w) { return w && !seen[w] && (seen[w] = 1); })
      .join(" ");
  }

  // The chip under the search box: says, in words, which printing the query is
  // actually asking eBay for. "" when nothing One-Piece-specific was typed.
  function badge(raw) {
    var p = parseQuery(raw);
    if (!p.code) return "";
    return p.treat ? p.treat.label : "Base Print";
  }

  // ── Catalogue ─────────────────────────────────────────────
  // cards_op.js declares CARDS_OP with `const`, which puts it in the global
  // LEXICAL scope rather than on `window` -- so it has to be reached by bare
  // name, exactly as index.html reaches CARDS. Going through root.CARDS_OP
  // silently finds undefined and leaves the catalogue looking empty.
  function rows() {
    return (typeof CARDS_OP !== "undefined" && CARDS_OP) ? CARDS_OP : [];
  }
  function ready() { return rows().length > 0; }

  // Set code -> set name, built once from the card IDs themselves so it can
  // never disagree with the catalogue it came from.
  var setNames = null;
  function setNameFor(code) {
    if (!setNames) {
      setNames = {};
      // Only a row from the set's OWN release names it. A promo product
      // reprints cards from every set, so keying on the card ID alone would
      // have "OP17" answering "Premium Card Collection".
      rows().forEach(function (r) {
        if (r[7] && !setNames[r[7]]) setNames[r[7]] = r[4];
      });
    }
    return setNames[String(code || "").toUpperCase()] || "";
  }

  // Search the bundled catalogue. cores are lowercase name fragments (from
  // index.html's nameCores, so punctuation in "Monkey.D.Luffy" never blocks a
  // match); every one has to appear in the name. A typed ID prefix-matches.
  //
  // Rows come back in catalogue order, which is newest set first, so the
  // printing you are most likely holding is near the top before any ranking.
  function search(raw, limit) {
    var all = rows();
    if (!all.length) return null;
    var p = parseQuery(raw);
    var cores = nameCores(p.name.join(" "));
    var keys = (p.codeRaw || p.setCode) ? codeKeys(p.codeRaw || p.setCode) : null;
    if (!cores.length && !keys) return [];

    var out = [];
    for (var i = 0; i < all.length && out.length < (limit || 60); i++) {
      var c = all[i];
      var ok = true;
      for (var j = 0; j < cores.length; j++) {
        if (c[6].indexOf(cores[j]) === -1) { ok = false; break; }
      }
      if (!ok) continue;
      if (keys) {
        var id = looseCode(c[1]), hit = false;
        for (var k = 0; k < keys.length; k++) {
          if (id.indexOf(keys[k]) === 0) { hit = true; break; }
        }
        if (!hit) continue;
      }
      // A typed treatment filters the list rather than just colouring it: once
      // you have said "aa", the plain print is not what you are pricing.
      if (p.treat && p.treat.code !== "BASE" && c[3] !== p.treat.code) continue;
      if (p.treat && p.treat.code === "BASE" && c[3]) continue;
      out.push(toRow(c));
    }
    return out;
  }

  // One catalogue row -> one dropdown row. `fill` is what lands back in the
  // search box when the row is picked: name first so the box stays readable,
  // then the ID, then the shorthand for the printing. buildQuery drops the name
  // again on the way to eBay, so a readable box and a tight search are not in
  // conflict.
  function toRow(c) {
    var t = c[3] ? BY_CODE[c[3]] : null;
    var tag = t ? t.type[0] : "";
    return {
      // True when this is the printing the card number was minted in, as
      // opposed to a later promo reprint of the same number. Used only to break
      // ties in the dropdown, where the original is the likelier card in hand.
      orig: !!c[7] && String(c[1]).split("-")[0].toUpperCase() === c[7],
      name: c[0],
      num: c[1],
      set: c[4],
      rarity: c[2],
      treat: c[3],
      label: t ? t.label : "",
      fill: (c[0] + " " + c[1] + (tag ? " " + tag : "")).trim(),
      src: ""
    };
  }

  // Same splitter index.html uses, duplicated rather than imported so this file
  // stays testable on its own. Sub-words under 2 characters are dropped except
  // the last, which is the prefix still being typed.
  function nameCores(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    var cores = [];
    words.forEach(function (w, wi) {
      var subs = w.split(/[^0-9a-zÀ-￿]+/i).filter(Boolean);
      subs.forEach(function (sub, si) {
        var isFinal = wi === words.length - 1 && si === subs.length - 1;
        if (sub.length >= 2 || isFinal) cores.push(sub.toLowerCase());
      });
    });
    return cores;
  }

  root.OnePiece = {
    setCanon: setCanon,
    parseQuery: parseQuery,
    parseForRecents: parseForRecents,
    buildQuery: buildQuery,
    badge: badge,
    search: search,
    ready: ready,
    setNameFor: setNameFor,
    canonCode: canonCode,
    looksLikeCode: looksLikeCode,
    treatments: TREATMENTS,
    base: BASE
  };
})(typeof window !== "undefined" ? window : this);
