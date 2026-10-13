"""books.csv(書籍リストの正本)の読み書きと検査の共通処理"""
import csv
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "books.csv")
JS_PATH = os.path.join(ROOT, "books.js")

FIELDS = [
    "isbn", "title", "author", "publisher", "pubdate", "pages", "series", "grades",
    "verify_status", "verify_sources", "verify_note",
]

# verified: ISBNチェックサム+2つ以上の独立した情報源でISBN・書名・版を照合済み
# single_source: 情報源1つでのみ照合(要再確認) / unverified: 未照合
# wrong / duplicate_edition: 誤り・別版の重複のため books.js に出力しない
STATUSES = ["verified", "single_source", "unverified", "wrong", "duplicate_edition"]
EXCLUDED_STATUSES = {"wrong", "duplicate_edition"}

INITIAL_MIN_YEAR = 2005
TARGET_TOTAL = 600


def isbn13_ok(isbn):
    if not re.fullmatch(r"\d{13}", isbn or ""):
        return False
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(isbn))
    return total % 10 == 0


def norm_title(s):
    s = unicodedata.normalize("NFKC", s or "")
    return re.sub(r"[\s・!?〜~()「」『』、。,.:：]", "", s)


def read_rows():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_rows(rows):
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})


def parse_grades(s):
    return [int(g) for g in (s or "").split("|") if g.strip()]


def sources_list(s):
    return [x.strip() for x in (s or "").split("|") if x.strip()]
