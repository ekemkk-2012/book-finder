"""照合・追加の調査結果(JSON Lines)を books.csv に取り込む。

使い方:
  python3 tools/merge_results.py --verify 照合結果.jsonl ... --add 追加候補.jsonl ...

照合結果: {"isbn", "verdict": OK|FIX|WRONG|UNVERIFIED, "fixes": {...}, "sources": [...], "note"}
  OK/FIX は情報源が2つ以上なら verified、1つなら single_source。fixes の値で各列を訂正する。
  WRONG は wrong(books.js に出力しない)。UNVERIFIED は状態を変えず note だけ追記する。
追加候補: {"title", "author", "publisher", "isbn", "pubdate", "pages", "series", "grades": [..], "sources": [..]}
  ISBNチェックサム不正・既存ISBN・既存と同じ書名(別版)は取り込まない。
"""
import argparse
import json
import re

from booklib import isbn13_ok, norm_title, read_rows, sources_list, write_rows

EDITION_WORDS = re.compile(r"ビッグブック|大型|新装版|ミニ版|改訂版|文庫版|携帯版|愛蔵版")


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def fmt_grades(g):
    if isinstance(g, str):
        g = [int(x) for x in re.split(r"[|, ]+", g) if x]
    return "|".join(str(x) for x in sorted(set(int(x) for x in g)))


def clean_title(t):
    return t.replace("！", "!").replace("？", "?").replace("＆", "&").replace("&amp;", "&")


FIXABLE = {"title", "author", "publisher", "pubdate", "pages", "series", "grades"}


def normalize_fix(field, value):
    """照合結果の訂正値を検証・正規化する。採用できない値は None"""
    if field not in FIXABLE:
        return None
    s = str(value).strip()
    if field == "grades":
        try:
            g = fmt_grades(value)
        except ValueError:
            return None
        return g if g and all(1 <= int(x) <= 6 for x in g.split("|")) else None
    if field == "pubdate":
        m = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", s)
        return f"{m.group(1)}-{m.group(2)}-{m.group(3) or '01'}" if m else None
    if field == "pages":
        return s if s.isdigit() and int(s) > 0 else None
    if field == "title":
        return clean_title(s) or None
    return s or None


def status_for(sources):
    return "verified" if len(sources) >= 2 else "single_source"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", nargs="*", default=[])
    ap.add_argument("--add", nargs="*", default=[])
    args = ap.parse_args()

    rows = read_rows()
    by_isbn = {r["isbn"]: r for r in rows}
    stats = {"verified": 0, "single_source": 0, "wrong": 0, "unverified_note": 0, "added": 0, "skipped": []}

    for path in args.verify:
        for res in load_jsonl(path):
            r = by_isbn.get(res.get("isbn"))
            if not r:
                stats["skipped"].append(f"照合対象なし {res.get('isbn')}")
                continue
            verdict = res.get("verdict")
            note = (res.get("note") or "").strip()
            if verdict in ("OK", "FIX"):
                for k, v in (res.get("fixes") or {}).items():
                    value = normalize_fix(k, v)
                    if value is None:
                        stats["skipped"].append(f"訂正値を採用せず {r['isbn']} {k}={v!r}")
                    else:
                        r[k] = value
                srcs = list(dict.fromkeys(sources_list(r["verify_sources"]) + [s for s in res.get("sources", []) if s]))
                r["verify_sources"] = " | ".join(srcs)
                r["verify_status"] = status_for(srcs)
                if note:
                    r["verify_note"] = (r["verify_note"] + " / " if r["verify_note"] else "") + note
                stats[r["verify_status"]] += 1
            elif verdict == "WRONG":
                r["verify_status"] = "wrong"
                r["verify_note"] = note
                stats["wrong"] += 1
            elif note:
                r["verify_note"] = (r["verify_note"] + " / " if r["verify_note"] else "") + note
                stats["unverified_note"] += 1

    titles = {norm_title(EDITION_WORDS.sub("", r["title"])) for r in rows if r["verify_status"] not in ("wrong", "duplicate_edition")}
    for path in args.add:
        for a in load_jsonl(path):
            isbn = str(a.get("isbn", "")).replace("-", "")
            title = clean_title(a.get("title", ""))
            key = norm_title(EDITION_WORDS.sub("", title))
            if not isbn13_ok(isbn):
                stats["skipped"].append(f"ISBN不正 {isbn} {title}")
                continue
            if isbn in by_isbn:
                stats["skipped"].append(f"既存ISBN {isbn} {title}")
                continue
            if key in titles:
                stats["skipped"].append(f"同じ書名あり {isbn} {title}")
                continue
            srcs = [s for s in a.get("sources", []) if s]
            row = {
                "isbn": isbn, "title": title, "author": a.get("author", ""), "publisher": a.get("publisher", ""),
                "pubdate": a.get("pubdate", ""), "pages": str(a["pages"]) if a.get("pages") else "",
                "series": a.get("series") or "", "grades": fmt_grades(a.get("grades", [])),
                "verify_status": status_for(srcs), "verify_sources": " | ".join(srcs), "verify_note": a.get("note", ""),
            }
            rows.append(row)
            by_isbn[isbn] = row
            titles.add(key)
            stats["added"] += 1

    write_rows(rows)
    skipped = stats.pop("skipped")
    print("取り込み結果:", stats)
    for s in skipped:
        print("  取り込まず:", s)


if __name__ == "__main__":
    main()
