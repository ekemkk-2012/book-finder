"""books.csv を機械的に検査する。

使い方: python3 tools/check_books.py
エラー(ISBN不正・重複・必須項目の欠落・books.jsとの不一致など)があれば終了コード1。
照合状況・学年別冊数・目標(2005年以降で600冊)までの残りも表示する。
"""
import collections
import re
import subprocess
import sys

from booklib import (
    EXCLUDED_STATUSES, FIELDS, INITIAL_MIN_YEAR, JS_PATH, STATUSES, TARGET_TOTAL,
    isbn13_ok, norm_title, parse_grades, read_rows, sources_list,
)

EDITION_WORDS = re.compile(r"ビッグブック|大型|新装版|ミニ版|改訂版|文庫版|携帯版|愛蔵版")


def main():
    rows = read_rows()
    errors = []
    warnings = []

    def err(r, msg):
        errors.append(f"{r.get('isbn')} {r.get('title')}: {msg}")

    def warn(r, msg):
        warnings.append(f"{r.get('isbn')} {r.get('title')}: {msg}")

    seen_isbn = {}
    seen_title = {}
    active = []
    for r in rows:
        if set(r.keys()) != set(FIELDS):
            err(r, "列の構成が不正")
            continue
        if r["verify_status"] not in STATUSES:
            err(r, f"verify_status が不正: {r['verify_status']}")
        if not isbn13_ok(r["isbn"]):
            err(r, "ISBN-13 の形式またはチェックサムが不正")
        if r["isbn"] in seen_isbn:
            err(r, "ISBN が重複")
        seen_isbn[r["isbn"]] = r
        for k in ("title", "author", "publisher", "pubdate", "grades"):
            if not r[k].strip():
                err(r, f"{k} が空")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["pubdate"]):
            err(r, "pubdate が YYYY-MM-DD でない")
        if r["pages"] and not r["pages"].isdigit():
            err(r, "pages が数値でない")
        grades = parse_grades(r["grades"])
        if not grades or any(g not in range(1, 7) for g in grades) or grades != sorted(set(grades)):
            err(r, f"grades が不正: {r['grades']}")
        if re.search(r"&amp;|！|？|＆", r["title"]):
            err(r, "書名に全角記号またはHTMLエンティティ")
        n_src = len(sources_list(r["verify_sources"]))
        if r["verify_status"] == "verified" and n_src < 2:
            err(r, "verified なのに情報源が2つ未満")
        if r["verify_status"] == "single_source" and n_src < 1:
            err(r, "single_source なのに情報源が空")
        if r["verify_status"] in EXCLUDED_STATUSES:
            continue
        active.append(r)
        key = norm_title(EDITION_WORDS.sub("", r["title"]))
        if key in seen_title:
            err(r, f"同じ書名(別版の可能性)が重複: {seen_title[key]['isbn']}")
        seen_title[key] = r

    series_norm = collections.defaultdict(set)
    for r in active:
        if r["series"]:
            series_norm[norm_title(r["series"])].add(r["series"])
    for variants in series_norm.values():
        if len(variants) > 1:
            warnings.append(f"シリーズ名の表記ゆれ: {sorted(variants)}")

    # books.js が books.csv から生成された最新のものか
    try:
        js = open(JS_PATH, encoding="utf-8").read()
        js_isbns = re.findall(r'isbn: "(\d+)"', js)
        if sorted(js_isbns) != sorted(r["isbn"] for r in active):
            errors.append("books.js が books.csv と一致しません(python3 tools/build_books_js.py を実行してください)")
    except FileNotFoundError:
        errors.append("books.js がありません")

    initial = [r for r in active if int(r["pubdate"][:4]) >= INITIAL_MIN_YEAR]
    by_grade = collections.Counter(g for r in initial for g in parse_grades(r["grades"]))
    status = collections.Counter(r["verify_status"] for r in rows)
    status_initial = collections.Counter(r["verify_status"] for r in initial)

    print(f"全{len(rows)}行 / 表示対象{len(active)}冊 / 初期表示({INITIAL_MIN_YEAR}年以降){len(initial)}冊 "
          f"(目標{TARGET_TOTAL}冊まで残り{max(0, TARGET_TOTAL - len(initial))}冊)")
    print("学年別(初期表示):", " ".join(f"{g}年={by_grade[g]}" for g in range(1, 7)))
    print("照合状況(全行):", " ".join(f"{s}={status[s]}" for s in STATUSES))
    print("照合状況(初期表示):", " ".join(f"{s}={status_initial[s]}" for s in STATUSES[:3]))
    for w in warnings:
        print("警告:", w)
    for e in errors:
        print("エラー:", e)
    if errors:
        print(f"エラー {len(errors)}件")
        sys.exit(1)
    print("エラーなし")


if __name__ == "__main__":
    main()
