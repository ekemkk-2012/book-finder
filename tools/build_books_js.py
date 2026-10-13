"""books.csv から books.js(ブラウザが読むシードデータ)を生成する。

使い方: python3 tools/build_books_js.py
verify_status が wrong / duplicate_edition の行は出力しない。
"""
import json

from booklib import EXCLUDED_STATUSES, JS_PATH, parse_grades, read_rows

HEADER = """// このファイルは tools/build_books_js.py が books.csv から自動生成します。直接編集しないでください。
// 書籍リストの正本は books.csv です(照合状況 verify_status・照合した情報源 verify_sources も記録)。
// pagesはページ数(一部は概算)、seriesはシリーズ名(単独作品はnull)、gradesは対象学年の配列です。
// 年齢と学年の対応(このツールでの定義): 7歳=1年生・8歳=2年生・9歳=3年生・
// 10歳=4年生・11歳=5年生・12歳=6年生 として、年齢別に紹介しているリソース
// (絵本ナビ等)の情報も学年に読み替えて参照しています。
const AGE_TO_GRADE = { 7: 1, 8: 2, 9: 3, 10: 4, 11: 5, 12: 6 };

const SEED_BOOKS = [
"""


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    lines = []
    for r in read_rows():
        if r["verify_status"] in EXCLUDED_STATUSES:
            continue
        series = js_str(r["series"]) if r["series"] else "null"
        grades = ",".join(str(g) for g in parse_grades(r["grades"]))
        lines.append(
            f'  {{ title: {js_str(r["title"])}, author: {js_str(r["author"])}, '
            f'publisher: {js_str(r["publisher"])}, isbn: {js_str(r["isbn"])}, '
            f'pubdate: {js_str(r["pubdate"])}, pages: {int(r["pages"]) if r["pages"] else "null"}, '
            f"series: {series}, grades: [{grades}] }},"
        )
    with open(JS_PATH, "w", encoding="utf-8") as f:
        f.write(HEADER + "\n".join(lines) + "\n];\n")
    print(f"books.js: {len(lines)}冊を出力しました")


if __name__ == "__main__":
    main()
