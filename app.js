"use strict";

/* ------------------------------------------------------------------
 * カーリル(calil.jp)のJSONP呼び出しユーティリティ
 * ------------------------------------------------------------------ */
let jsonpSeq = 0;

function jsonpRequest(baseUrl, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = "calil_cb_" + Date.now() + "_" + jsonpSeq++;
    const query = Object.assign({}, params, { callback: callbackName, format: "json" });

    const qs = Object.keys(query)
      .filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== "")
      .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(query[k]))
      .join("&");

    const script = document.createElement("script");
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("タイムアウトしました。ネットワーク接続を確認してください。"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (data) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("APIリクエストに失敗しました。"));
    };

    script.src = baseUrl + "?" + qs;
    document.head.appendChild(script);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* 図書館システムを検索する(https://api.calil.jp/library、appkey必須) */
async function searchLibrarySystems({ appkey, pref, city }) {
  const data = await jsonpRequest("https://api.calil.jp/library", { appkey, pref, city });
  if (!Array.isArray(data)) {
    throw new Error("図書館情報の取得に失敗しました。APIキーや都道府県・市区町村の指定を確認してください。");
  }
  const bySystem = new Map();
  for (const lib of data) {
    if (!bySystem.has(lib.systemid)) {
      bySystem.set(lib.systemid, { systemid: lib.systemid, systemname: lib.systemname, branches: [] });
    }
    bySystem.get(lib.systemid).branches.push({
      name: lib.formal || lib.short || "(名称不明)",
      libkey: lib.libkey || "",
      address: lib.address || "",
      libid: lib.libid || "",
      siteUrl: lib.url_pc || "",
    });
  }
  return Array.from(bySystem.values());
}

/* 蔵書チェック (https://api.calil.jp/check、要appkey)。continue=1の間ポーリングする */
async function checkAvailability({ appkey, isbnList, systemidList }, onProgress) {
  let data = await jsonpRequest("https://api.calil.jp/check", {
    appkey, isbn: isbnList.join(","), systemid: systemidList.join(","),
  });

  let attempts = 0;
  while (data && data.continue === 1 && attempts < 20) {
    if (onProgress) onProgress(attempts);
    await sleep(2000);
    data = await jsonpRequest("https://api.calil.jp/check", { appkey, session: data.session });
    attempts++;
  }
  if (!data || typeof data.books !== "object") {
    throw new Error("蔵書情報の取得に失敗しました。");
  }
  return data;
}

/* ------------------------------------------------------------------
 * カーリルへのリンク生成
 * (API仕様書「カーリルへのリンク」の項に従い、APIで得た図書館名・貸出状況を
 *  表示する際は必ずカーリルの該当ページへリンクしています)
 * ------------------------------------------------------------------ */
function calilOpenUrl(book) {
  const params = new URLSearchParams();
  if (book.isbn) {
    params.set("rft.isbn", book.isbn);
  } else {
    if (book.title) params.set("rft.btitle", book.title);
    if (book.author) params.set("rft.au", book.author);
  }
  return "https://api.calil.jp/openurl?" + params.toString();
}

function calilLibraryListUrl(prefSlug, city) {
  const base = "https://calil.jp/library/" + prefSlug + "/";
  return city ? base + encodeURIComponent(city) : base;
}

/* 図書館データベースのlibidを使った個別図書館ページへのリンク */
function calilLibraryPageUrl(libid, formalName) {
  return "https://calil.jp/library/" + encodeURIComponent(libid) + "/" + encodeURIComponent(formalName);
}

/* 蔵書チェック結果(systemid・libkey)からの図書館ページへのリンク */
function calilLibrarySearchUrl(systemid, libkey) {
  const params = new URLSearchParams({ s: systemid, k: libkey });
  return "https://calil.jp/library/search?" + params.toString();
}

/* ------------------------------------------------------------------
 * 除外(既読・苦手)の永続化
 * ------------------------------------------------------------------ */
const EXCLUSION_KEY = "book_finder_exclusions_v1";

function loadExclusions() {
  try {
    const raw = localStorage.getItem(EXCLUSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveExclusions(map) {
  try { localStorage.setItem(EXCLUSION_KEY, JSON.stringify(map)); } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------------
 * 地域・図書館の選択の永続化
 * (この端末のブラウザにのみ保存されます。別の端末では最初の1回だけ
 *  検索・選択をやり直す必要があります)
 * ------------------------------------------------------------------ */
const LIBRARY_PREF_KEY = "book_finder_library_pref_v1";

function loadLibraryPref() {
  try {
    const raw = localStorage.getItem(LIBRARY_PREF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveLibraryPref(pref) {
  try { localStorage.setItem(LIBRARY_PREF_KEY, JSON.stringify(pref)); } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------------
 * 共有APIキー
 * このツール専用にアプリ登録した共有キーです(個人アカウントには紐づきません)。
 * カーリルの蔵書チェックAPIの利用上限はアクセス元(≒利用者)ごとにカウントされる
 * ため、共有していても他の利用者と取り合いになりません。
 * ------------------------------------------------------------------ */
const SHARED_APPKEY = "10965e7b783d571dd70fe7e333cf7268";

function getAppkey() {
  return SHARED_APPKEY;
}

/* ------------------------------------------------------------------
 * 学年フィルタの永続化
 * ------------------------------------------------------------------ */
const GRADE_PREF_KEY = "book_finder_grades_v1";
const ALL_GRADES = [1, 2, 3, 4, 5, 6];

function loadSelectedGrades() {
  try {
    const raw = localStorage.getItem(GRADE_PREF_KEY);
    if (!raw) return new Set(ALL_GRADES);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? new Set(arr) : new Set(ALL_GRADES);
  } catch (e) {
    return new Set(ALL_GRADES);
  }
}

function saveSelectedGrades(gradeSet) {
  try { localStorage.setItem(GRADE_PREF_KEY, JSON.stringify(Array.from(gradeSet))); } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------------
 * 画面のロジック
 * ------------------------------------------------------------------ */
const VISIBLE_LIMIT = 30;
const DEFAULT_MIN_YEAR = 2005;
const CHECK_BATCH_SIZE = 10;
const HELD_STATUS_PRIORITY = ["貸出可", "蔵書あり", "館内のみ", "貸出中", "予約中", "準備中", "休館中"];

const state = {
  minYear: DEFAULT_MIN_YEAR,
  keyword: "",
  extraBooks: [],
  librarySystems: [],
  selectedSystemIds: new Set(),
  branchFilter: "",
  exclusions: loadExclusions(), // { isbn: { reason: "read"|"disliked", title } }
  selectedGrades: loadSelectedGrades(),
  holdings: {}, // { isbn: { systemid: { status, libkey, reserveurl } } } 蔵書チェック結果の累積
  inFlight: new Set(), // 蔵書チェック中のISBN
  checking: false,
  checkRerun: false,
  checkError: "",
  checkIncomplete: false,
  renderedIsbns: [],
  shownIsbns: [], // 現在表示中の候補(苦手・既読にすると自動で次の候補に入れ替わる)
  showAll: false, // 「すべて表示」モードかどうか
};

const el = {};

function bindEls() {
  [
    "pref", "city", "searchLibBtn", "libStatus", "libResultsWrap", "libResults", "branchFilter", "libListLink",
    "gradeChecks", "minYear", "keyword", "bookStatus", "checkBtn", "showAllToggle",
    "seriesWrap", "seriesToggle", "seriesList",
    "excludedWrap", "excludedToggle", "excludedCount", "excludedList",
    "gbKeyword", "gbSearchBtn", "gbResults", "gbStatus",
  ].forEach((id) => (el[id] = document.getElementById(id)));
  el.bookTableBody = document.querySelector("#bookTable tbody");
}

function renderGradeChecks() {
  el.gradeChecks.innerHTML = "";
  for (const g of ALL_GRADES) {
    const label = document.createElement("label");
    const checked = state.selectedGrades.has(g) ? "checked" : "";
    label.innerHTML = `<input type="checkbox" class="grade-check" value="${g}" ${checked}>${g}年生`;
    label.querySelector("input").addEventListener("change", (ev) => {
      if (ev.target.checked) state.selectedGrades.add(g);
      else state.selectedGrades.delete(g);
      saveSelectedGrades(state.selectedGrades);
      resetVisibleSlate();
      renderBookTable();
      renderSeriesPanel();
    });
    el.gradeChecks.appendChild(label);
  }
}

function initPrefectureDropdown() {
  for (const [name] of PREFECTURES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === "東京都") opt.selected = true;
    el.pref.appendChild(opt);
  }
}

function initYearDropdown() {
  const currentYear = 2026;
  for (let y = currentYear; y >= 2000; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = y + "年以降";
    if (y === DEFAULT_MIN_YEAR) opt.selected = true;
    el.minYear.appendChild(opt);
  }
  state.minYear = DEFAULT_MIN_YEAR;
}

function allBooks() {
  return SEED_BOOKS.concat(state.extraBooks);
}

function isExcluded(isbn) {
  return Object.prototype.hasOwnProperty.call(state.exclusions, isbn);
}

/* ------------------------------------------------------------------
 * 選択した図書館での所蔵判定
 * カーリルの status は「照会が正常に終わったか」を表すだけなので、所蔵の有無は
 * libkey(館ごとの貸出状況。所蔵がなければ空)で判定する
 * ------------------------------------------------------------------ */
function libraryActive() {
  return state.librarySystems.length > 0 && state.selectedSystemIds.size > 0;
}

/* 図書館名フィルタに一致する館のlibkey集合(フィルタなしならnull=全館) */
function allowedLibkeys(systemid) {
  const kw = state.branchFilter.trim().toLowerCase();
  if (!kw) return null;
  const sys = state.librarySystems.find((s) => s.systemid === systemid);
  if (!sys) return null;
  return new Set(
    sys.branches
      .filter((br) => br.name.toLowerCase().includes(kw) || br.libkey.toLowerCase().includes(kw))
      .map((br) => br.libkey)
  );
}

/* state: unchecked | checking | held | notHeld | pending(照会が時間内に終わらず) | error */
function holdingInfo(isbn) {
  if (state.inFlight.has(isbn)) return { state: "checking", systems: [] };
  const per = state.holdings[isbn];
  const sids = Array.from(state.selectedSystemIds);
  if (!per || sids.some((sid) => !per[sid])) return { state: "unchecked", systems: [] };
  let anyHeld = false;
  let anyRunning = false;
  let allError = true;
  const systems = sids.map((sid) => {
    const info = per[sid];
    if (info.status === "Running") anyRunning = true;
    if (info.status !== "Error") allError = false;
    const allowed = allowedLibkeys(sid);
    const entries = Object.entries(info.libkey || {}).filter(
      ([key, st]) => st !== "蔵書なし" && (!allowed || allowed.has(key))
    );
    if (entries.length) anyHeld = true;
    return { sid, info, entries };
  });
  const st = anyHeld ? "held" : anyRunning ? "pending" : allError ? "error" : "notHeld";
  return { state: st, systems };
}

function isNotHeld(isbn) {
  return libraryActive() && holdingInfo(isbn).state === "notHeld";
}

function filteredBooks({ ignoreHoldings = false } = {}) {
  const kw = state.keyword.trim().toLowerCase();
  return allBooks().filter((b) => {
    const year = parseInt(b.pubdate.slice(0, 4), 10);
    if (year < state.minYear) return false;
    if (isExcluded(b.isbn)) return false;
    if (!ignoreHoldings && isNotHeld(b.isbn)) return false;
    if (kw && !(b.title.toLowerCase().includes(kw) || b.author.toLowerCase().includes(kw))) {
      return false;
    }
    if (b.grades && b.grades.length && !b.grades.some((g) => state.selectedGrades.has(g))) {
      return false;
    }
    return true;
  });
}

function gradeLabel(grades) {
  if (!grades || !grades.length) return "";
  const min = Math.min(...grades);
  const max = Math.max(...grades);
  return min === max ? `${min}年生` : `${min}〜${max}年生`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function excludeBook(book, reason) {
  state.exclusions[book.isbn] = { reason, title: book.title };
  saveExclusions(state.exclusions);
  renderBookTable();
  renderExcludedList();
  renderSeriesPanel();
}

function restoreBook(isbn) {
  delete state.exclusions[isbn];
  saveExclusions(state.exclusions);
  renderBookTable();
  renderExcludedList();
  renderSeriesPanel();
}

/* 表示中の候補(shownIsbns)を、条件に合わなくなった本をその場で次の未表示の本に
 * 入れ替えつつ(末尾に追い出さず、同じ行の位置で差し替える)、上限(VISIBLE_LIMIT)
 * まで埋め直す */
function refillVisibleSlate(pool) {
  const poolIsbns = new Set(pool.map((b) => b.isbn));
  const shownSet = new Set(state.shownIsbns);
  const nextCandidates = pool.map((b) => b.isbn).filter((isbn) => !shownSet.has(isbn));
  let ci = 0;
  for (let i = 0; i < state.shownIsbns.length; i++) {
    if (poolIsbns.has(state.shownIsbns[i])) continue;
    state.shownIsbns[i] = ci < nextCandidates.length ? nextCandidates[ci++] : null;
  }
  state.shownIsbns = state.shownIsbns.filter((isbn) => isbn !== null);
  while (state.shownIsbns.length < VISIBLE_LIMIT && ci < nextCandidates.length) {
    state.shownIsbns.push(nextCandidates[ci++]);
  }
}

function resetVisibleSlate() {
  state.shownIsbns = [];
}

function renderBookTable() {
  const pool = filteredBooks();
  let books;
  if (state.showAll) {
    books = pool;
  } else {
    refillVisibleSlate(pool);
    const byIsbn = new Map(allBooks().map((b) => [b.isbn, b]));
    books = state.shownIsbns.map((isbn) => byIsbn.get(isbn)).filter(Boolean);
  }
  state.renderedIsbns = books.map((b) => b.isbn);
  el.bookTableBody.innerHTML = "";
  for (const b of books) {
    const tr = document.createElement("tr");
    tr.dataset.isbn = b.isbn;
    tr.innerHTML = `
      <td class="title-cell">${escapeHtml(b.title)}${b.series ? `<span class="series-tag">${escapeHtml(b.series)}</span>` : ""}${gradeLabel(b.grades) ? `<span class="grade-tag">${gradeLabel(b.grades)}</span>` : ""}</td>
      <td>${escapeHtml(b.author)}</td>
      <td>${escapeHtml(b.publisher)}</td>
      <td>${escapeHtml(b.pubdate)}</td>
      <td class="pages-cell">${b.pages ? escapeHtml(String(b.pages)) + "p" : "-"}</td>
      <td class="isbn-cell">${escapeHtml(b.isbn)}</td>
      <td class="status-cell">${statusCellHtml(b)}</td>
      <td class="exclude-cell">
        <button type="button" class="pill-btn read" data-isbn="${escapeHtml(b.isbn)}">読んだ</button>
        <button type="button" class="pill-btn disliked" data-isbn="${escapeHtml(b.isbn)}">苦手</button>
      </td>
    `;
    tr.querySelector(".pill-btn.read").addEventListener("click", () => excludeBook(b, "read"));
    tr.querySelector(".pill-btn.disliked").addEventListener("click", () => excludeBook(b, "disliked"));
    el.bookTableBody.appendChild(tr);
  }
  let msg;
  if (books.length === 0) {
    const emptyMsg = libraryActive()
      ? "選択した図書館に所蔵がある本が見つかりませんでした。学年・発行年・キーワード・図書館の選択を見直してください。"
      : "条件に一致する本がありません。発行年・キーワード・除外設定を見直してください。";
    el.bookTableBody.innerHTML = `<tr><td colspan="8" class="empty-row">${emptyMsg}</td></tr>`;
    msg = "";
  } else if (state.showAll) {
    msg = `${books.length}冊表示中(すべて表示モード)`;
  } else {
    msg = pool.length > books.length
      ? `${pool.length}冊中${books.length}冊を表示中(「苦手」「読んだ」にすると自動で次の候補に入れ替わります)`
      : `${books.length}冊表示中`;
  }
  el.bookStatus.textContent = [msg, holdingStatusMessage()].filter(Boolean).join(" ");
  el.showAllToggle.textContent = state.showAll ? `候補を${VISIBLE_LIMIT}件ずつ表示する` : "すべて表示する";
  el.showAllToggle.classList.toggle("hidden", pool.length <= VISIBLE_LIMIT);
  scheduleHoldingCheck();
}

function holdingStatusMessage() {
  if (!libraryActive()) return "";
  const base = filteredBooks({ ignoreHoldings: true });
  let checked = 0;
  let notHeld = 0;
  for (const b of base) {
    const st = holdingInfo(b.isbn).state;
    if (st !== "unchecked" && st !== "checking") checked++;
    if (st === "notHeld") notHeld++;
  }
  const parts = [`【選択した図書館に所蔵がある本だけを候補にしています。確認済み${checked}冊のうち所蔵なし${notHeld}冊を除外】`];
  if (state.checking) parts.push("所蔵を確認しています...");
  if (state.checkIncomplete) parts.push("一部の本は図書館側の応答が時間内に終わらず「確認未完了」のままです(「所蔵を再確認する」で再試行できます)。");
  if (state.checkError) parts.push("エラー: " + state.checkError + "(「所蔵を再確認する」で再試行できます)");
  return parts.join(" ");
}

function safeHttpUrl(url) {
  return /^https?:\/\//i.test(url || "") ? escapeHtml(url) : "";
}

function statusCellHtml(book) {
  const openurl = `<span class="openurl-fallback"><a href="${calilOpenUrl(book)}" target="_blank" rel="noopener">カーリルで見る →</a></span>`;
  if (!libraryActive()) return openurl;
  const h = holdingInfo(book.isbn);
  if (h.state === "unchecked") return `<span class="pill pill-busy">未確認</span> ${openurl}`;
  if (h.state === "checking") return `<span class="pill pill-busy">確認中</span>`;
  const parts = h.systems.map(({ sid, info, entries }) => {
    const sysMeta = state.librarySystems.find((s) => s.systemid === sid);
    const sysName = escapeHtml(sysMeta ? sysMeta.systemname : sid);
    if (info.status === "Error") return `<div><span class="pill pill-unknown">取得エラー</span><span class="status-detail">${sysName}</span></div>`;
    if (info.status === "Running" && !entries.length) return `<div><span class="pill pill-busy">確認未完了</span><span class="status-detail">${sysName}</span></div>`;
    if (!entries.length) return `<div><span class="pill pill-unknown">所蔵なし</span><span class="status-detail">${sysName}</span></div>`;
    const values = entries.map(([, st]) => st);
    const label = HELD_STATUS_PRIORITY.find((s) => values.includes(s)) || values[0];
    const pill = label === "貸出可" || label === "蔵書あり" || label === "館内のみ" ? "pill-ok" : "pill-busy";
    const detail = entries
      .map(([branch, st]) => `<a href="${calilLibrarySearchUrl(sid, branch)}" target="_blank" rel="noopener">${escapeHtml(branch)}</a>=${escapeHtml(st)}`)
      .join("、 ");
    const reserve = safeHttpUrl(info.reserveurl);
    return `<div><span class="pill ${pill}">${escapeHtml(label)}</span><span class="status-detail">${sysName}</span><br><span class="status-detail">${detail}</span>${reserve ? ` <a href="${reserve}" target="_blank" rel="noopener">予約/詳細</a>` : ""}</div>`;
  });
  return parts.join("") || openurl;
}

/* 表示中の未確認の本を、選択した図書館で自動的に蔵書チェックする。
 * 所蔵なしの本は候補から外れ、補充された本もまた確認する(表示中が全部確認済みになるまで) */
function scheduleHoldingCheck() {
  if (!libraryActive() || state.checkError) return;
  if (!state.renderedIsbns.some((isbn) => holdingInfo(isbn).state === "unchecked")) return;
  if (state.checking) {
    state.checkRerun = true;
    return;
  }
  runHoldingCheck();
}

async function runHoldingCheck() {
  state.checking = true;
  try {
    for (;;) {
      state.checkRerun = false;
      if (!libraryActive()) break;
      const targets = state.renderedIsbns.filter((isbn) => holdingInfo(isbn).state === "unchecked");
      if (!targets.length) break;
      const batch = targets.slice(0, CHECK_BATCH_SIZE);
      const systemids = Array.from(state.selectedSystemIds);
      batch.forEach((isbn) => state.inFlight.add(isbn));
      renderBookTable();
      let data;
      try {
        data = await checkAvailability({ appkey: getAppkey(), isbnList: batch, systemidList: systemids });
      } finally {
        batch.forEach((isbn) => state.inFlight.delete(isbn));
      }
      if (data.continue === 1) state.checkIncomplete = true;
      for (const isbn of batch) {
        const per = (state.holdings[isbn] = state.holdings[isbn] || {});
        const got = data.books[isbn] || {};
        for (const sid of systemids) {
          per[sid] = got[sid] || { status: "Error", libkey: {} };
        }
      }
      renderBookTable();
    }
  } catch (err) {
    state.checkError = err.message;
  } finally {
    state.checking = false;
    renderBookTable();
  }
}

function handleRecheckHoldings() {
  if (!libraryActive()) {
    el.bookStatus.textContent = "図書館を検索して、確認したい図書館を選択してください。";
    return;
  }
  if (state.checking) return;
  state.holdings = {};
  state.checkError = "";
  state.checkIncomplete = false;
  renderBookTable();
}

/* ------------------------------------------------------------------
 * シリーズ単位の一括操作(既読・苦手・戻す)
 * ------------------------------------------------------------------ */
function seriesSummary() {
  const map = new Map();
  for (const b of allBooks()) {
    if (!b.series) continue;
    if (!map.has(b.series)) map.set(b.series, []);
    map.get(b.series).push(b);
  }
  return Array.from(map.entries())
    .filter(([, books]) => books.length >= 2)
    .map(([series, books]) => ({
      series,
      books,
      excludedCount: books.filter((b) => isExcluded(b.isbn)).length,
    }));
}

function renderSeriesPanel() {
  const summaries = seriesSummary();
  el.seriesWrap.classList.toggle("hidden", summaries.length === 0);
  el.seriesList.innerHTML = "";
  for (const s of summaries) {
    const div = document.createElement("div");
    div.className = "series-item";
    div.innerHTML = `
      <span><span class="series-name">${escapeHtml(s.series)}</span><span class="series-count">全${s.books.length}冊中${s.excludedCount}冊を非表示中</span></span>
      <span class="series-actions">
        <button type="button" class="read">シリーズ全部「読んだ」</button>
        <button type="button" class="disliked">シリーズ全部「苦手」</button>
        <button type="button" class="restore">シリーズ全部を戻す</button>
      </span>
    `;
    div.querySelector(".read").addEventListener("click", () => bulkSetSeries(s.books, "read"));
    div.querySelector(".disliked").addEventListener("click", () => bulkSetSeries(s.books, "disliked"));
    div.querySelector(".restore").addEventListener("click", () => bulkRestoreSeries(s.books));
    el.seriesList.appendChild(div);
  }
}

function bulkSetSeries(books, reason) {
  for (const b of books) {
    state.exclusions[b.isbn] = { reason, title: b.title };
  }
  saveExclusions(state.exclusions);
  renderBookTable();
  renderExcludedList();
  renderSeriesPanel();
}

function bulkRestoreSeries(books) {
  for (const b of books) {
    delete state.exclusions[b.isbn];
  }
  saveExclusions(state.exclusions);
  renderBookTable();
  renderExcludedList();
  renderSeriesPanel();
}

function renderExcludedList() {
  const entries = Object.entries(state.exclusions);
  el.excludedWrap.classList.toggle("hidden", entries.length === 0);
  el.excludedCount.textContent = String(entries.length);
  el.excludedList.innerHTML = "";
  for (const [isbn, info] of entries) {
    const div = document.createElement("div");
    div.className = "excluded-item";
    const tagLabel = info.reason === "read" ? "読んだ" : "苦手";
    div.innerHTML = `
      <span><span class="tag ${info.reason}">${tagLabel}</span>${escapeHtml(info.title)}</span>
      <button type="button" data-isbn="${escapeHtml(isbn)}">リストに戻す</button>
    `;
    div.querySelector("button").addEventListener("click", () => restoreBook(isbn));
    el.excludedList.appendChild(div);
  }
}

function updateLibListLink() {
  const prefName = el.pref.value;
  const entry = PREFECTURES.find(([name]) => name === prefName);
  const slug = entry ? entry[1] : "tokyo";
  const city = el.city.value.trim();
  el.libListLink.href = calilLibraryListUrl(slug, city);
}

function renderLibraryResults() {
  const kw = state.branchFilter.trim().toLowerCase();
  const systems = state.librarySystems.filter((sys) =>
    !kw ||
    sys.systemname.toLowerCase().includes(kw) ||
    sys.branches.some((br) => br.name.toLowerCase().includes(kw))
  );

  el.libResults.innerHTML = "";
  if (systems.length === 0) {
    el.libResults.innerHTML = `<div class="lib-empty">絞り込み条件に一致する図書館がありません。</div>`;
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "lib-toolbar";
  toolbar.innerHTML = `<button type="button" id="selAllLib">すべて選択</button><button type="button" id="selNoneLib">すべて解除</button>`;
  el.libResults.appendChild(toolbar);

  for (const sys of systems) {
    const div = document.createElement("div");
    div.className = "lib-item";
    const checked = state.selectedSystemIds.has(sys.systemid) ? "checked" : "";
    const matchingBranches = kw ? sys.branches.filter((br) => br.name.toLowerCase().includes(kw)) : [];
    const branchesToShow = matchingBranches.length ? matchingBranches : sys.branches;
    const branchesHtml = branchesToShow.map((br) => `
      <div class="lib-branch">
        <span>${escapeHtml(br.name)}${br.address ? " ・ " + escapeHtml(br.address) : ""}</span>
        ${br.libid ? `<a href="${calilLibraryPageUrl(br.libid, br.name)}" target="_blank" rel="noopener">カーリルで見る →</a>` : ""}
      </div>
    `).join("");
    const countLabel = branchesToShow.length === sys.branches.length
      ? `${sys.branches.length}館`
      : `${branchesToShow.length}/${sys.branches.length}館(絞り込み中)`;
    div.innerHTML = `
      <label class="lib-item-head">
        <input type="checkbox" class="lib-check" value="${escapeHtml(sys.systemid)}" ${checked}>
        <span class="lib-name">${escapeHtml(sys.systemname || sys.systemid)}</span>
        <span class="lib-sub">${escapeHtml(sys.systemid)} ・ ${countLabel}</span>
      </label>
      <div class="lib-branches">${branchesHtml}</div>
    `;
    el.libResults.appendChild(div);
  }

  document.getElementById("selAllLib").addEventListener("click", () => {
    el.libResults.querySelectorAll(".lib-check").forEach((cb) => { cb.checked = true; state.selectedSystemIds.add(cb.value); });
    persistLibrarySelection();
    renderBookTable();
  });
  document.getElementById("selNoneLib").addEventListener("click", () => {
    el.libResults.querySelectorAll(".lib-check").forEach((cb) => { cb.checked = false; });
    state.selectedSystemIds.clear();
    persistLibrarySelection();
    renderBookTable();
  });
  el.libResults.querySelectorAll(".lib-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedSystemIds.add(cb.value);
      else state.selectedSystemIds.delete(cb.value);
      persistLibrarySelection();
      renderBookTable();
    });
  });
}

function persistLibrarySelection() {
  saveLibraryPref({
    pref: el.pref.value,
    city: el.city.value.trim(),
    systemids: Array.from(state.selectedSystemIds),
  });
}

async function handleSearchLibraries() {
  const appkey = getAppkey();
  const pref = el.pref.value;
  const city = el.city.value.trim();

  el.libStatus.textContent = "検索中...";
  el.searchLibBtn.disabled = true;
  try {
    const systems = await searchLibrarySystems({ appkey, pref, city });
    state.librarySystems = systems;

    const saved = loadLibraryPref();
    const allIds = systems.map((s) => s.systemid);
    if (saved && saved.pref === pref && saved.city === city && Array.isArray(saved.systemids)) {
      const savedIds = saved.systemids.filter((id) => allIds.includes(id));
      state.selectedSystemIds = new Set(savedIds.length ? savedIds : allIds);
    } else {
      state.selectedSystemIds = new Set(allIds);
    }

    state.branchFilter = "";
    el.branchFilter.value = "";
    el.libResultsWrap.classList.remove("hidden");
    renderLibraryResults();
    persistLibrarySelection();
    el.libStatus.textContent = systems.length
      ? `${systems.length}件の図書館システムが見つかりました。図書館名で絞り込めます。`
      : "図書館が見つかりませんでした。市区町村名を確認してください。";
    state.checkError = "";
    renderBookTable();
  } catch (err) {
    el.libStatus.textContent = "エラー: " + err.message + " (「この地域の図書館一覧をカーリルで見る」からも探せます)";
  } finally {
    el.searchLibBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------
 * 追加の本を検索する(Google Books APIを使用、CORS制限で動かない環境もあります)
 * ------------------------------------------------------------------ */
async function handleGoogleBooksSearch() {
  const q = el.gbKeyword.value.trim();
  if (!q) {
    el.gbStatus.textContent = "検索キーワードを入力してください。";
    return;
  }
  el.gbStatus.textContent = "検索中...";
  el.gbResults.innerHTML = "";
  try {
    const url = "https://www.googleapis.com/books/v1/volumes?maxResults=10&langRestrict=ja&q=" +
      encodeURIComponent(q + " 児童書");
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) {
      el.gbStatus.textContent = "本が見つかりませんでした。";
      return;
    }
    el.gbStatus.textContent = `${items.length}件見つかりました。追加したい本の「追加」を押してください。`;
    for (const item of items) {
      const info = item.volumeInfo || {};
      const isbn13 = (info.industryIdentifiers || []).find((i) => i.type === "ISBN_13");
      if (!isbn13) continue; // ISBNが無い本はカーリルにリンクできないため除外
      const div = document.createElement("div");
      div.className = "gb-item";
      div.innerHTML = `
        <div>
          <div class="gb-title">${escapeHtml(info.title || "(タイトル不明)")}</div>
          <div class="gb-sub">${escapeHtml((info.authors || []).join("、"))} / ${escapeHtml(info.publisher || "")} / ${escapeHtml(info.publishedDate || "")} / ISBN:${escapeHtml(isbn13.identifier)}</div>
        </div>
        <button type="button" class="btn btn-small gb-add">追加</button>
      `;
      div.querySelector(".gb-add").addEventListener("click", () => {
        state.extraBooks.push({
          title: info.title || "(タイトル不明)",
          author: (info.authors || []).join("、") || "不明",
          publisher: info.publisher || "不明",
          isbn: isbn13.identifier,
          pubdate: (info.publishedDate || "0000") + (info.publishedDate && info.publishedDate.length === 4 ? "-01-01" : ""),
        });
        renderBookTable();
        div.querySelector(".gb-add").textContent = "追加済み";
        div.querySelector(".gb-add").disabled = true;
      });
      el.gbResults.appendChild(div);
    }
  } catch (err) {
    el.gbStatus.textContent =
      "検索に失敗しました(ブラウザやネットワークのCORS制限でGoogle Books APIに直接アクセスできない場合があります)。手動で本を追加することはできませんが、上のおすすめリストはそのままご利用いただけます。詳細: " + err.message;
  }
}

/* ------------------------------------------------------------------
 * 初期化
 * ------------------------------------------------------------------ */
function init() {
  bindEls();
  initPrefectureDropdown();
  initYearDropdown();
  renderGradeChecks();
  renderBookTable();
  renderExcludedList();
  renderSeriesPanel();

  const savedLibPref = loadLibraryPref();
  if (savedLibPref && savedLibPref.pref) el.pref.value = savedLibPref.pref;
  if (savedLibPref && savedLibPref.city) el.city.value = savedLibPref.city;
  updateLibListLink();

  el.pref.addEventListener("change", updateLibListLink);
  el.city.addEventListener("input", updateLibListLink);
  el.searchLibBtn.addEventListener("click", handleSearchLibraries);

  // 共有APIキーを使うため、地域(デフォルトまたは記憶済み)があれば自動的に図書館を検索する
  if (el.city.value.trim()) {
    handleSearchLibraries();
  }
  el.branchFilter.addEventListener("input", () => {
    state.branchFilter = el.branchFilter.value;
    renderLibraryResults();
    renderBookTable();
  });
  el.minYear.addEventListener("change", () => {
    state.minYear = parseInt(el.minYear.value, 10);
    resetVisibleSlate();
    renderBookTable();
  });
  el.keyword.addEventListener("input", () => {
    state.keyword = el.keyword.value;
    resetVisibleSlate();
    renderBookTable();
  });
  el.showAllToggle.addEventListener("click", () => {
    state.showAll = !state.showAll;
    if (!state.showAll) resetVisibleSlate();
    renderBookTable();
  });
  el.checkBtn.addEventListener("click", handleRecheckHoldings);
  el.excludedToggle.addEventListener("click", () => {
    const expanded = el.excludedToggle.getAttribute("aria-expanded") === "true";
    el.excludedToggle.setAttribute("aria-expanded", String(!expanded));
    el.excludedList.classList.toggle("hidden", expanded);
  });
  el.seriesToggle.addEventListener("click", () => {
    const expanded = el.seriesToggle.getAttribute("aria-expanded") === "true";
    el.seriesToggle.setAttribute("aria-expanded", String(!expanded));
    el.seriesList.classList.toggle("hidden", expanded);
  });
  el.gbSearchBtn.addEventListener("click", handleGoogleBooksSearch);
}

document.addEventListener("DOMContentLoaded", init);
