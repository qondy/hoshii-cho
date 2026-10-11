import { User } from 'firebase/auth';
import { loginWithGoogle, logout, onAuthChange } from './auth';
import { submitFeedback } from './feedback';
import { cancelCropper, chooseSquareCrop } from './cropper';
import { loadImage, processPhoto, thumbFromDataUrl } from './image';
import { SAMPLE_ITEMS } from './samples';
import {
  createCategory, createItem, deleteCategory, deleteItem, ensureDefaultCategories, loadPhotos,
  MAX_CATEGORIES, MAX_LINKS, MAX_PHOTOS, MAX_PRICE, renameCategory,
  safeUrl, subscribeCategories, subscribeItems, updateItem, updateQuick,
} from './store';
import { Category, Item, ItemData, LinkItem, Priority, Status } from './types';
import { closeOverlay, iconEl, openOverlay, showToast, textEl } from './ui';

// ============================================================
// 固定アイコン（開発者定義のSVGのみ。ユーザー入力は含めない）
// ============================================================
const svg = (inner: string, size = 18, fill = 'none'): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="${fill}" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON_APP = '<path d="M10 26 H54 V35 H10 Z"/><path d="M14 35 V54 H50 V35"/><path d="M32 26 V54"/><path d="M32 26 C26 26 19 24 18 18 C17 12 24 10 28 14 C31 17 32 26 32 26 Z"/><path d="M32 26 C38 26 45 24 46 18 C47 12 40 10 36 14 C33 17 32 26 32 26 Z"/>';
const ICON_STAR = '<path d="M32 8 L39.5 24 L57 26.2 L44.2 38.2 L47.6 55.5 L32 47 L16.4 55.5 L19.8 38.2 L7 26.2 L24.5 24 Z"/>';
const ICON_LINK = '<path d="M28 36 C31 40 37 40 40 37 L50 27 C53 24 53 18 50 15 C47 12 41 12 38 15 L34 19"/><path d="M36 28 C33 24 27 24 24 27 L14 37 C11 40 11 46 14 49 C17 52 23 52 26 49 L30 45"/>';
const ICON_EDIT = '<path d="M40 12 L52 24 L24 52 H12 V40 Z"/><path d="M34 18 L46 30"/>';
const ICON_TRASH = '<path d="M12 18 H52"/><path d="M26 18 V12 H38 V18"/><path d="M17 18 L20 54 H44 L47 18"/>';

const STATUS_LABEL: Record<Status, string> = { want: '気になる', plan: '買う予定', bought: '買った', dropped: 'やめた' };
const STATUS_ORDER: Status[] = ['want', 'plan', 'bought', 'dropped'];
const PRIORITY_LABEL: Record<Priority, string> = { 1: 'いつか', 2: 'ほしい', 3: '絶対ほしい' };
const PRIORITIES: Priority[] = [1, 2, 3];

const SORT_KEY = 'hoshii-cho:sort';
const CATEGORY_KEY = 'hoshii-cho:category';
const STATUS_KEY = 'hoshii-cho:status';
const UNCATEGORIZED = '__none__';
const ALL = '__all__';
const ACTIVE = '__active__'; // 気になる＋買う予定（検討中）
const SORTS = ['new', 'priority', 'price-asc', 'price-desc', 'wanted', 'name'];

// ============================================================
// 状態
// ============================================================
let currentUser: User | null = null;
let items: Item[] = [];
let categories: Category[] = [];
let itemsLoaded = false;
let unsubItems: (() => void) | null = null;
let unsubCategories: (() => void) | null = null;

let searchQuery = '';
let selectedCategory = lsGet(CATEGORY_KEY) || ALL;
let selectedStatus = lsGet(STATUS_KEY) || ACTIVE;
let sortKey = lsGet(SORT_KEY) || 'new';

let detailId: string | null = null;
let detailPhotos: string[] = [];
let detailPhotoToken = 0;

let editingId: string | null = null;
let editorPhotos: string[] = [];
let editorPhotosLoaded = true;
let editorPhotosChanged = false;
let editorPriority: Priority = 2;
let editorSnapshot = '';
let editorBusy = false;
let photoBusy = false;

let confirmAction: (() => Promise<void>) | null = null;

// ============================================================
// 要素
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
};

const loginScreen = $('login-screen');
const appEl = $('app');
const itemList = $<HTMLUListElement>('item-list');
const loadingEl = $('loading');
const emptyFirst = $('empty-first');
const emptyMatch = $('empty-match');
const summaryEl = $('summary');
const statusBar = $('status-bar');
const categoryBar = $('category-bar');
const searchInput = $<HTMLInputElement>('input-search');
const sortSelect = $<HTMLSelectElement>('select-sort');

const detailOverlay = $('detail-overlay');
const editorOverlay = $('editor-overlay');
const editorForm = $<HTMLFormElement>('editor-form');
const cropOverlay = $('crop-overlay');
const categoryOverlay = $('category-overlay');
const discardOverlay = $('discard-dialog-overlay');
const confirmOverlay = $('confirm-dialog-overlay');
const feedbackOverlay = $('feedback-modal-overlay');

const photoPicker = $('photo-picker');
const photoAdd = $('photo-add');
const photoInput = $<HTMLInputElement>('input-photo');
const nameInput = $<HTMLInputElement>('input-name');
const priceInput = $<HTMLInputElement>('input-price');
const categorySelect = $<HTMLSelectElement>('input-category');
const statusSelect = $<HTMLSelectElement>('input-status');
const wantedInput = $<HTMLInputElement>('input-wanted');
const buyByInput = $<HTMLInputElement>('input-buyby');
const reasonInput = $<HTMLTextAreaElement>('input-reason');
const memoInput = $<HTMLTextAreaElement>('input-memo');
const linkRows = $('link-rows');
const editorPriorityEl = $('editor-priority');
const editorSaveBtn = $<HTMLButtonElement>('btn-editor-save');

// ============================================================
// ユーティリティ
// ============================================================
function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* プライベートモードなどでは保存しない */
  }
}

function todayStr(): string {
  return toDateStr(Date.now());
}

function toDateStr(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const formatYen = (n: number): string => `¥${n.toLocaleString('ja-JP')}`;

/** 「12,800」「１２８００円」「¥12800」などを数値にする。空欄は null、読めなければ NaN */
function parsePrice(raw: string): number | null {
  const s = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s,，、¥￥円]/g, '');
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

function formatDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function formatShort(s: string): string {
  const [, m, d] = s.split('-').map(Number);
  return `${m}/${d}`;
}

/** 指定日からの経過日数（未来の日付や未入力は null） */
function daysSince(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((today - then) / 86_400_000);
  return diff >= 0 ? diff : null;
}

/** 欲しいと思った日（未入力なら登録日で代用） */
const wantedDate = (item: Item): string => item.wantedAt || toDateStr(item.createdAt);

/** 「欲しいと思ってから〇日」。買った・やめたものは出さない */
function ageText(item: Item): string {
  if (item.status === 'bought' || item.status === 'dropped') return '';
  const days = daysSince(wantedDate(item));
  if (days === null) return '';
  return days === 0 ? '今日、欲しくなった' : `欲しいと思って${days}日`;
}

function categoryName(id: string): string {
  return categories.find((c) => c.id === id)?.name ?? '';
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function findItem(id: string | null): Item | undefined {
  return id ? items.find((i) => i.id === id) : undefined;
}

function starsEl(priority: Priority): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'stars';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `優先度：${PRIORITY_LABEL[priority]}`);
  PRIORITIES.forEach((p) => {
    wrap.append(iconEl(svg(ICON_STAR, 14, p <= priority ? 'currentColor' : 'none'), p <= priority ? '' : 'stars__off'));
  });
  return wrap;
}

function statusChip(status: Status): HTMLElement {
  return textEl('span', `chip chip--status chip--status-${status}`, STATUS_LABEL[status]);
}

// ============================================================
// 一覧
// ============================================================
function statusMatches(item: Item): boolean {
  if (selectedStatus === ALL) return true;
  if (selectedStatus === ACTIVE) return item.status === 'want' || item.status === 'plan';
  return item.status === selectedStatus;
}

function filteredItems(): Item[] {
  const q = searchQuery.trim().toLowerCase();
  const list = items.filter((item) => {
    if (!statusMatches(item)) return false;
    if (selectedCategory === UNCATEGORIZED) {
      if (item.categoryId && categoryName(item.categoryId)) return false;
    } else if (selectedCategory !== ALL && item.categoryId !== selectedCategory) {
      return false;
    }
    if (!q) return true;
    const hay = [item.name, item.reason, item.memo, categoryName(item.categoryId), ...item.links.map((l) => l.label)]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, 'ja');
  list.sort((a, b) => {
    switch (sortKey) {
      case 'priority':
        return b.priority - a.priority || b.createdAt - a.createdAt;
      case 'price-asc':
        // 値段が安い順（未入力は最後）
        return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || byName(a, b);
      case 'price-desc':
        // 値段が高い順（未入力は最後）
        return (b.price ?? -1) - (a.price ?? -1) || byName(a, b);
      case 'wanted':
        // 欲しいと思ってから長い順
        return wantedDate(a).localeCompare(wantedDate(b)) || a.createdAt - b.createdAt;
      case 'name':
        return byName(a, b);
      default:
        return b.createdAt - a.createdAt;
    }
  });
  return list;
}

function renderStatusBar(): void {
  statusBar.textContent = '';
  const chips: { id: string; label: string; count: number }[] = [
    { id: ACTIVE, label: '検討中', count: items.filter((i) => i.status === 'want' || i.status === 'plan').length },
    ...STATUS_ORDER.map((s) => ({ id: s as string, label: STATUS_LABEL[s], count: items.filter((i) => i.status === s).length })),
    { id: ALL, label: 'すべて', count: items.length },
  ];
  chips.forEach(({ id, label, count }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'category-chip' + (selectedStatus === id ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(selectedStatus === id));
    b.append(textEl('span', '', label), textEl('span', 'category-chip__count', String(count)));
    b.addEventListener('click', () => {
      selectedStatus = id;
      lsSet(STATUS_KEY, id);
      render();
    });
    statusBar.append(b);
  });
}

function renderCategoryBar(): void {
  categoryBar.textContent = '';
  const hasUncategorized = items.some((i) => !i.categoryId || !categoryName(i.categoryId));
  const valid = selectedCategory === ALL
    || (selectedCategory === UNCATEGORIZED && hasUncategorized)
    || categories.some((c) => c.id === selectedCategory);
  if (!valid) selectedCategory = ALL;

  const chip = (id: string, label: string, count: number) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'category-chip' + (selectedCategory === id ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(selectedCategory === id));
    b.append(textEl('span', '', label), textEl('span', 'category-chip__count', String(count)));
    b.addEventListener('click', () => {
      selectedCategory = id;
      lsSet(CATEGORY_KEY, id);
      render();
    });
    categoryBar.append(b);
  };

  chip(ALL, 'すべて', items.length);
  categories.forEach((c) => chip(c.id, c.name, items.filter((i) => i.categoryId === c.id).length));
  if (hasUncategorized) chip(UNCATEGORIZED, '未分類', items.filter((i) => !i.categoryId || !categoryName(i.categoryId)).length);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'category-chip category-chip--edit';
  edit.append(iconEl(svg(ICON_EDIT, 14)), textEl('span', '', 'カテゴリを編集'));
  edit.addEventListener('click', openCategoryEditor);
  categoryBar.append(edit);
}

function renderItemCard(item: Item): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item-card' + (item.status === 'bought' || item.status === 'dropped' ? ' is-closed' : '');

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item-card__btn';
  b.setAttribute('aria-label', `${item.name}の詳細を開く`);
  b.addEventListener('click', () => openDetail(item.id));

  const thumb = document.createElement('div');
  thumb.className = 'item-card__thumb';
  if (item.thumb) {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
  } else {
    thumb.append(iconEl(svg(ICON_APP, 40), 'item-card__placeholder'));
  }

  const body = document.createElement('div');
  body.className = 'item-card__body';
  const badges = document.createElement('div');
  badges.className = 'item-card__badges';
  badges.append(statusChip(item.status), starsEl(item.priority));
  body.append(badges);
  body.append(textEl('h3', 'item-card__name', item.name));
  const cat = categoryName(item.categoryId);
  if (cat) body.append(textEl('p', 'item-card__meta', cat));
  if (item.price !== null) body.append(textEl('p', 'item-card__price', formatYen(item.price)));
  const age = ageText(item);
  const due = item.status === 'plan' && item.buyBy ? `${formatShort(item.buyBy)}までに買う` : '';
  const foot = [due, age].filter(Boolean).join(' ・ ');
  if (foot) body.append(textEl('p', 'item-card__age', foot));

  b.append(thumb, body);
  li.append(b);
  return li;
}

function renderSummary(listCount: number): void {
  summaryEl.textContent = '';
  if (!items.length) return;
  const sum = (list: Item[]) => list.reduce((acc, i) => acc + (i.price ?? 0), 0);
  const plan = sum(items.filter((i) => i.status === 'plan'));
  const active = sum(items.filter((i) => i.status === 'want' || i.status === 'plan'));
  summaryEl.append(`${listCount}件 ・ 買う予定の合計 `);
  summaryEl.append(textEl('span', 'summary-total', formatYen(plan)));
  if (active !== plan) summaryEl.append(` （気になるも含めて ${formatYen(active)}）`);
  summaryEl.title = '値段を入力していないものは合計に含みません';
}

function render(): void {
  if (!itemsLoaded) return;
  loadingEl.classList.add('hidden');
  renderStatusBar();
  renderCategoryBar();

  itemList.textContent = '';
  const list = filteredItems();
  list.forEach((item) => itemList.append(renderItemCard(item)));
  renderSummary(list.length);

  emptyFirst.classList.toggle('hidden', items.length > 0);
  emptyMatch.classList.toggle('hidden', items.length === 0 || list.length > 0);

  if (detailId) {
    if (findItem(detailId)) renderDetail();
    else closeDetail();
  }
}

// ============================================================
// 詳細
// ============================================================
function openDetail(id: string): void {
  if (!findItem(id)) return;
  const switching = detailId !== id;
  detailId = id;
  if (switching) {
    detailPhotos = [];
    void fetchDetailPhotos(id);
  }
  renderDetail();
  openOverlay(detailOverlay);
}

async function fetchDetailPhotos(id: string): Promise<void> {
  const item = findItem(id);
  if (!currentUser || !item || item.photoCount === 0) return;
  const token = ++detailPhotoToken;
  try {
    const photos = await loadPhotos(currentUser.uid, id);
    if (token !== detailPhotoToken || detailId !== id) return;
    detailPhotos = photos;
    renderDetailPhotos();
  } catch {
    if (token === detailPhotoToken) showToast('写真を読み込めませんでした');
  }
}

function closeDetail(): void {
  detailId = null;
  detailPhotos = [];
  detailPhotoToken++;
  closeOverlay(detailOverlay);
}

function renderDetailPhotos(): void {
  const item = findItem(detailId);
  const wrap = $('detail-photos');
  wrap.textContent = '';
  if (!item) return;
  const src = detailPhotos[0] || item.thumb; // 本体の写真を読み込むまではサムネイルを表示
  if (!src) {
    wrap.append(iconEl(svg(ICON_APP, 56), 'photo-viewer__placeholder'));
    return;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = `${item.name}の写真`;
  img.className = 'photo-viewer__img' + (detailPhotos.length ? '' : ' is-loading');
  wrap.append(img);
}

const quickBusy = new Set<string>();

async function setQuick(itemId: string, patch: { status?: Status; priority?: Priority }, btn?: HTMLButtonElement): Promise<void> {
  if (!currentUser || !findItem(itemId) || quickBusy.has(itemId)) return;
  quickBusy.add(itemId);
  if (btn) btn.disabled = true;
  try {
    await updateQuick(currentUser.uid, itemId, patch);
    if (patch.status === 'bought') showToast('買えました！おめでとうございます');
    else if (patch.status === 'plan') showToast('買う予定にしました');
    else if (patch.status === 'dropped') showToast('「やめた」に移しました');
    else if (patch.status === 'want') showToast('「気になる」に戻しました');
  } catch {
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    quickBusy.delete(itemId);
    if (btn) btn.disabled = false;
  }
}

function renderDetail(): void {
  const item = findItem(detailId);
  if (!item) return;

  $('detail-category').textContent = categoryName(item.categoryId) || '未分類';
  $('detail-name').textContent = item.name;
  const meta: string[] = [];
  if (item.price !== null) meta.push(formatYen(item.price));
  const age = ageText(item);
  if (age) meta.push(age);
  $('detail-meta').textContent = meta.join(' ・ ');

  renderDetailPhotos();

  // 状態・優先度（押すとその場で保存）
  const statusSeg = $('detail-status');
  statusSeg.textContent = '';
  STATUS_ORDER.forEach((s) => {
    const sb = document.createElement('button');
    sb.type = 'button';
    sb.className = `status-seg__btn status-seg__btn--${s}` + (item.status === s ? ' is-active' : '');
    sb.textContent = STATUS_LABEL[s];
    sb.setAttribute('aria-pressed', String(item.status === s));
    sb.addEventListener('click', () => {
      if (item.status !== s) void setQuick(item.id, { status: s }, sb);
    });
    statusSeg.append(sb);
  });
  const prioSeg = $('detail-priority');
  prioSeg.textContent = '';
  PRIORITIES.forEach((p) => {
    const pb = document.createElement('button');
    pb.type = 'button';
    pb.className = 'priority-seg__btn' + (item.priority === p ? ' is-active' : '');
    pb.setAttribute('aria-pressed', String(item.priority === p));
    pb.append(starsEl(p), textEl('span', '', PRIORITY_LABEL[p]));
    pb.addEventListener('click', () => {
      if (item.priority !== p) void setQuick(item.id, { priority: p }, pb);
    });
    prioSeg.append(pb);
  });

  const dates: string[] = [];
  const wDays = daysSince(wantedDate(item));
  dates.push(`欲しいと思った日：${formatDate(wantedDate(item))}${wDays === null ? '' : wDays === 0 ? '（今日）' : `（${wDays}日前）`}`);
  if (item.buyBy) dates.push(`買う予定日：${formatDate(item.buyBy)}`);
  $('detail-dates').textContent = dates.join(' ／ ');

  $('detail-reason').textContent = item.reason;
  $('detail-reason-section').classList.toggle('hidden', !item.reason);

  // リンク
  const links = $<HTMLUListElement>('detail-links');
  links.textContent = '';
  if (!item.links.length) {
    links.append(textEl('li', 'manual-links__empty', '「編集」から、買う場所や参考ページのURLを登録できます。'));
  }
  item.links.forEach((mn) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'manual-link';
    a.href = mn.url; // 保存時・読込時に http/https のみに検証済み
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(iconEl(svg(ICON_LINK, 18), 'manual-link__icon'), textEl('span', 'manual-link__label', mn.label));
    let host = '';
    try {
      host = new URL(mn.url).hostname;
    } catch {
      host = '';
    }
    if (host) a.append(textEl('span', 'manual-link__host', host));
    li.append(a);
    links.append(li);
  });

  $('detail-memo').textContent = item.memo;
  $('detail-memo-section').classList.toggle('hidden', !item.memo);
}

// ============================================================
// 登録・編集
// ============================================================
function fillCategorySelect(selected: string): void {
  categorySelect.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '未分類';
  categorySelect.append(none);
  categories.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    categorySelect.append(o);
  });
  categorySelect.value = categories.some((c) => c.id === selected) ? selected : '';
}

function renderEditorPriority(): void {
  editorPriorityEl.textContent = '';
  PRIORITIES.forEach((p) => {
    const pb = document.createElement('button');
    pb.type = 'button';
    pb.className = 'priority-seg__btn' + (editorPriority === p ? ' is-active' : '');
    pb.setAttribute('aria-pressed', String(editorPriority === p));
    pb.append(starsEl(p), textEl('span', '', PRIORITY_LABEL[p]));
    pb.addEventListener('click', () => {
      editorPriority = p;
      renderEditorPriority();
    });
    editorPriorityEl.append(pb);
  });
}

function addLinkRow(m: LinkItem = { label: '', url: '' }): void {
  if (linkRows.children.length >= MAX_LINKS) {
    showToast(`リンクは${MAX_LINKS}件まで登録できます`);
    return;
  }
  const row = document.createElement('div');
  row.className = 'manual-row';
  const label = document.createElement('input');
  label.type = 'text';
  label.className = 'manual-row__label';
  label.maxLength = 30;
  label.placeholder = '名前（例：公式サイト）';
  label.value = m.label;
  label.setAttribute('aria-label', 'リンクの名前');
  const url = document.createElement('input');
  url.type = 'url';
  url.className = 'manual-row__url';
  url.maxLength = 500;
  url.placeholder = 'https://';
  url.value = m.url;
  url.inputMode = 'url';
  url.setAttribute('aria-label', 'URL');
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn';
  del.setAttribute('aria-label', 'このリンクを削除');
  del.append(iconEl(svg(ICON_TRASH, 16), ''));
  del.addEventListener('click', () => {
    row.remove();
    updateLinkAddBtn();
  });
  row.append(label, url, del);
  linkRows.append(row);
  updateLinkAddBtn();
}

function updateLinkAddBtn(): void {
  $('btn-link-add').classList.toggle('hidden', linkRows.children.length >= MAX_LINKS);
}

function readLinks(): { list: LinkItem[]; invalid: boolean } {
  const list: LinkItem[] = [];
  let invalid = false;
  linkRows.querySelectorAll<HTMLElement>('.manual-row').forEach((row) => {
    const label = (row.querySelector('.manual-row__label') as HTMLInputElement).value.trim();
    const raw = (row.querySelector('.manual-row__url') as HTMLInputElement).value.trim();
    if (!raw && !label) return;
    const url = safeUrl(raw);
    if (!url) {
      invalid = true;
      return;
    }
    list.push({ label: label || 'リンク', url });
  });
  return { list, invalid };
}

function renderPhotoPicker(): void {
  photoPicker.querySelectorAll('.photo-picker__item, .photo-picker__loading').forEach((el) => el.remove());
  if (!editorPhotosLoaded) {
    photoPicker.insertBefore(textEl('div', 'photo-picker__loading', '写真を読み込み中…'), photoAdd);
  }
  editorPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-picker__item';
    const img = document.createElement('img');
    img.src = p;
    img.alt = `写真${i + 1}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'photo-picker__remove';
    del.setAttribute('aria-label', `写真${i + 1}を削除`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      editorPhotos.splice(i, 1);
      editorPhotosChanged = true;
      renderPhotoPicker();
    });
    wrap.append(img, del);
    photoPicker.insertBefore(wrap, photoAdd);
  });
  const full = editorPhotos.length >= MAX_PHOTOS || !editorPhotosLoaded || photoBusy;
  photoAdd.classList.toggle('is-disabled', full);
  photoInput.disabled = full;
  const label = photoAdd.querySelector('span');
  if (label) label.textContent = photoBusy ? '処理中…' : editorPhotos.length >= MAX_PHOTOS ? '1枚まで' : '写真を追加';
}

async function onPhotoSelected(): Promise<void> {
  const files = Array.from(photoInput.files ?? []);
  photoInput.value = '';
  if (!files.length || photoBusy) return;
  const room = MAX_PHOTOS - editorPhotos.length;
  if (room <= 0) return;
  if (files.length > room) showToast(`写真は${MAX_PHOTOS}枚までです。先頭の${room}枚を追加します`);
  photoBusy = true;
  renderPhotoPicker();
  const targets = files.slice(0, room);
  try {
    for (let i = 0; i < targets.length; i++) {
      const file = targets[i];
      try {
        if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
        const img = await loadImage(file);
        // 正方形で保存するので、切り抜く範囲を選んでもらう
        const crop = await chooseSquareCrop(img, targets.length > 1 ? `${i + 1} / ${targets.length}` : '');
        if (!crop || !editorOverlay.classList.contains('is-open')) continue;
        editorPhotos.push(processPhoto(img, crop));
        editorPhotosChanged = true;
      } catch (err) {
        showToast(errMessage(err, 'この画像は追加できませんでした'));
      }
    }
  } finally {
    photoBusy = false;
    renderPhotoPicker();
  }
}

function editorState(): string {
  return JSON.stringify([
    nameInput.value, priceInput.value, categorySelect.value, statusSelect.value, wantedInput.value, buyByInput.value,
    reasonInput.value, memoInput.value, editorPriority,
    Array.from(linkRows.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value),
    editorPhotosChanged,
  ]);
}

function openEditor(id: string | null): void {
  const item = findItem(id);
  editingId = item ? item.id : null;
  editorPhotosChanged = false;
  $('editor-title').textContent = item ? '欲しい物を編集' : '欲しい物を登録';
  nameInput.value = item?.name ?? '';
  priceInput.value = item?.price != null ? item.price.toLocaleString('ja-JP') : '';
  const defaultCat = !item && selectedCategory !== ALL && selectedCategory !== UNCATEGORIZED ? selectedCategory : '';
  fillCategorySelect(item ? item.categoryId : defaultCat);
  statusSelect.value = item ? item.status : 'want';
  wantedInput.value = item ? wantedDate(item) : todayStr();
  wantedInput.max = todayStr();
  buyByInput.value = item?.buyBy ?? '';
  reasonInput.value = item?.reason ?? '';
  memoInput.value = item?.memo ?? '';
  editorPriority = item ? item.priority : 2;
  renderEditorPriority();
  linkRows.textContent = '';
  (item?.links ?? []).forEach((m) => addLinkRow(m));
  if (!item) addLinkRow();
  updateLinkAddBtn();

  if (item && item.photoCount > 0) {
    // 詳細画面で読み込み済みならそれを使う
    if (detailId === item.id && detailPhotos.length) {
      editorPhotos = [...detailPhotos];
      editorPhotosLoaded = true;
    } else {
      editorPhotos = [];
      editorPhotosLoaded = false;
      const uid = currentUser?.uid;
      if (uid) {
        loadPhotos(uid, item.id)
          .then((photos) => {
            if (editingId !== item.id) return;
            editorPhotos = photos;
            editorPhotosLoaded = true;
            renderPhotoPicker();
          })
          .catch(() => {
            showToast('写真を読み込めませんでした。写真以外は編集できます');
            editorPhotosLoaded = true;
            renderPhotoPicker();
          });
      }
    }
  } else {
    editorPhotos = [];
    editorPhotosLoaded = true;
  }
  renderPhotoPicker();
  editorSnapshot = editorState();
  openOverlay(editorOverlay);
  if (!item) nameInput.focus();
}

function requestCloseEditor(): void {
  if (editorBusy) return;
  if (editorState() !== editorSnapshot) openOverlay(discardOverlay);
  else closeEditor();
}

function closeEditor(): void {
  cancelCropper();
  closeOverlay(editorOverlay);
  closeOverlay(discardOverlay);
  editingId = null;
  editorPhotos = [];
}

async function saveEditor(e: Event): Promise<void> {
  e.preventDefault();
  if (editorBusy || !currentUser) return;
  const name = nameInput.value.trim();
  if (!name) {
    showToast('名前を入力してください');
    nameInput.focus();
    return;
  }
  if (photoBusy || !editorPhotosLoaded) {
    showToast('写真の処理が終わるまでお待ちください');
    return;
  }
  const price = parsePrice(priceInput.value);
  if (price !== null && (Number.isNaN(price) || price > MAX_PRICE)) {
    showToast('値段は数字で入力してください（1億円未満）');
    priceInput.focus();
    return;
  }
  const links = readLinks();
  if (links.invalid) {
    showToast('URLは https:// から始まる形で入力してください');
    return;
  }

  editorBusy = true;
  editorSaveBtn.disabled = true;
  editorSaveBtn.textContent = '保存中…';
  try {
    const existing = findItem(editingId);
    let thumb = existing?.thumb ?? '';
    if (!existing || editorPhotosChanged) thumb = editorPhotos[0] ? await thumbFromDataUrl(editorPhotos[0]) : '';
    const data: ItemData = {
      name,
      categoryId: categorySelect.value,
      price,
      priority: editorPriority,
      status: statusSelect.value as Status,
      wantedAt: wantedInput.value,
      buyBy: buyByInput.value,
      reason: reasonInput.value,
      memo: memoInput.value,
      links: links.list,
      thumb,
      photoCount: existing && !editorPhotosChanged ? existing.photoCount : editorPhotos.length,
    };

    if (existing) {
      await updateItem(currentUser.uid, existing.id, data, editorPhotosChanged ? editorPhotos : null);
      if (editorPhotosChanged && detailId === existing.id) detailPhotos = [...editorPhotos];
      closeEditor();
      showToast('保存しました');
    } else {
      const photos = [...editorPhotos];
      const id = await createItem(currentUser.uid, data, photos);
      closeEditor();
      showToast('登録しました');
      // 登録した欲しい物の詳細をそのまま開く（写真は手元のものを使う）
      detailId = id;
      detailPhotos = photos;
      if (findItem(id)) renderDetail();
      openOverlay(detailOverlay);
    }
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    editorBusy = false;
    editorSaveBtn.disabled = false;
    editorSaveBtn.textContent = '保存する';
  }
}

// ============================================================
// カテゴリ編集
// ============================================================
function openCategoryEditor(): void {
  renderCategoryEditor();
  openOverlay(categoryOverlay);
}

function renderCategoryEditor(): void {
  const list = $<HTMLUListElement>('category-edit-list');
  list.textContent = '';
  if (!categories.length) list.append(textEl('li', 'category-edit__empty', 'カテゴリがありません。下の欄から追加できます。'));
  categories.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'category-edit__row';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = c.name;
    input.setAttribute('aria-label', `${c.name}の名前`);
    const commit = async () => {
      const v = input.value.trim();
      if (!currentUser || v === c.name) return;
      if (!v) {
        input.value = c.name;
        return;
      }
      try {
        await renameCategory(currentUser.uid, c.id, v);
        showToast('名前を変更しました');
      } catch {
        input.value = c.name;
        showToast('変更に失敗しました');
      }
    };
    input.addEventListener('change', () => void commit());
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        input.blur();
      }
    });
    const count = items.filter((i) => i.categoryId === c.id).length;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn is-danger';
    del.setAttribute('aria-label', `${c.name}を削除`);
    del.append(iconEl(svg(ICON_TRASH, 16), ''));
    del.addEventListener('click', () => {
      closeOverlay(categoryOverlay);
      askConfirm(
        'カテゴリを削除しますか？',
        count ? `「${c.name}」を削除します。中の${count}件の製品は「未分類」になります。` : `「${c.name}」を削除します。`,
        async () => {
          if (!currentUser) return;
          const ids = items.filter((i) => i.categoryId === c.id).map((i) => i.id);
          await deleteCategory(currentUser.uid, c.id, ids);
          showToast('カテゴリを削除しました');
        },
      );
    });
    li.append(input, textEl('span', 'category-edit__count', `${count}件`), del);
    list.append(li);
  });
  const full = categories.length >= MAX_CATEGORIES;
  ($('input-category-new') as HTMLInputElement).disabled = full;
  ($('btn-category-add') as HTMLButtonElement).disabled = full;
}

let categoryBusy = false;
async function addCategory(e: Event): Promise<void> {
  e.preventDefault();
  const input = $<HTMLInputElement>('input-category-new');
  const name = input.value.trim();
  if (!name || !currentUser || categoryBusy) return;
  if (categories.some((c) => c.name === name)) {
    showToast('同じ名前のカテゴリがあります');
    return;
  }
  if (categories.length >= MAX_CATEGORIES) {
    showToast(`カテゴリは${MAX_CATEGORIES}個まで作れます`);
    return;
  }
  categoryBusy = true;
  try {
    await createCategory(currentUser.uid, name);
    input.value = '';
  } catch {
    showToast('追加に失敗しました');
  } finally {
    categoryBusy = false;
  }
}

// ============================================================
// 確認ダイアログ（カスタムUI）
// ============================================================
function askConfirm(title: string, text: string, action: () => Promise<void>, okLabel = '削除する'): void {
  $('confirm-dialog-title').textContent = title;
  $('confirm-dialog-text').textContent = text;
  $('btn-confirm-delete').textContent = okLabel;
  confirmAction = action;
  openOverlay(confirmOverlay);
}

async function runConfirm(): Promise<void> {
  const action = confirmAction;
  if (!action) return;
  const btn = $<HTMLButtonElement>('btn-confirm-delete');
  btn.disabled = true;
  try {
    await action();
    confirmAction = null;
    closeOverlay(confirmOverlay);
  } catch {
    showToast('処理に失敗しました。もう一度お試しください');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// サンプル
// ============================================================
let samplesBusy = false;
async function addSamples(): Promise<void> {
  if (!currentUser || samplesBusy) return;
  samplesBusy = true;
  const btn = $<HTMLButtonElement>('btn-add-samples');
  btn.disabled = true;
  try {
    for (const s of SAMPLE_ITEMS) {
      const cat = categories.find((c) => c.name === s.categoryName);
      await createItem(
        currentUser.uid,
        {
          name: s.name, categoryId: cat?.id ?? '', price: s.price, priority: s.priority, status: s.status,
          wantedAt: todayStr(), buyBy: '', reason: s.reason, memo: s.memo, links: [], thumb: '', photoCount: 0,
        },
        [],
      );
    }
    showToast('サンプルを追加しました');
  } catch {
    showToast('追加に失敗しました');
  } finally {
    samplesBusy = false;
    btn.disabled = false;
  }
}

// ============================================================
// 認証
// ============================================================
function startSession(user: User): void {
  currentUser = user;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  $('user-info').classList.remove('hidden');
  const avatar = $<HTMLImageElement>('user-avatar');
  if (user.photoURL) {
    avatar.src = user.photoURL;
    avatar.classList.remove('hidden');
  } else {
    avatar.classList.add('hidden');
  }
  $('user-name').textContent = user.displayName ?? '';

  ensureDefaultCategories(user.uid).catch((err) => console.error(err));
  unsubCategories = subscribeCategories(user.uid, (list) => {
    categories = list;
    render();
    if (categoryOverlay.classList.contains('is-open')) renderCategoryEditor();
  }, (err) => console.error(err));
  unsubItems = subscribeItems(user.uid, (list) => {
    items = list;
    itemsLoaded = true;
    render();
  }, (err) => {
    console.error(err);
    loadingEl.textContent = 'データを読み込めませんでした。ページを再読み込みしてください。';
  });
}

function endSession(): void {
  unsubItems?.();
  unsubCategories?.();
  unsubItems = null;
  unsubCategories = null;
  currentUser = null;
  items = [];
  categories = [];
  itemsLoaded = false;
  itemList.textContent = '';
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = '読み込み中…';
  [detailOverlay, editorOverlay, cropOverlay, categoryOverlay, discardOverlay, confirmOverlay].forEach(closeOverlay);
  detailId = null;
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

// ============================================================
// イベント
// ============================================================
function bindEvents(): void {
  let loginBusy = false;
  $('btn-google-login').addEventListener('click', async () => {
    if (loginBusy) return;
    loginBusy = true;
    try {
      await loginWithGoogle();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        showToast('ログインに失敗しました。ポップアップを許可して再度お試しください');
      }
    } finally {
      loginBusy = false;
    }
  });
  $('btn-logout').addEventListener('click', () => {
    logout().catch(() => showToast('ログアウトに失敗しました'));
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    render();
  });
  sortSelect.value = SORTS.includes(sortKey) ? sortKey : 'new';
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value;
    lsSet(SORT_KEY, sortKey);
    render();
  });
  $('btn-clear-filter').addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    selectedCategory = ALL;
    selectedStatus = ALL;
    lsSet(CATEGORY_KEY, ALL);
    lsSet(STATUS_KEY, ALL);
    render();
  });

  $('btn-new').addEventListener('click', () => openEditor(null));
  $('btn-empty-new').addEventListener('click', () => openEditor(null));
  $('btn-add-samples').addEventListener('click', () => void addSamples());

  // 詳細
  $('btn-detail-close').addEventListener('click', closeDetail);
  $('btn-detail-edit').addEventListener('click', () => openEditor(detailId));
  $('btn-detail-delete').addEventListener('click', () => {
    const item = findItem(detailId);
    if (!item) return;
    askConfirm('欲しい物を削除しますか？', `「${item.name}」と、写真・理由・メモをすべて削除します。元に戻せません。`, async () => {
      if (!currentUser) return;
      await deleteItem(currentUser.uid, item.id);
      closeDetail();
      showToast('削除しました');
    });
  });

  // 登録・編集
  editorForm.addEventListener('submit', (e) => void saveEditor(e));
  $('btn-editor-close').addEventListener('click', requestCloseEditor);
  $('btn-editor-cancel').addEventListener('click', requestCloseEditor);
  $('btn-link-add').addEventListener('click', () => addLinkRow());
  photoInput.addEventListener('change', () => void onPhotoSelected());
  $('btn-discard-cancel').addEventListener('click', () => closeOverlay(discardOverlay));
  $('btn-discard-ok').addEventListener('click', closeEditor);

  // カテゴリ
  $('btn-category-close').addEventListener('click', () => closeOverlay(categoryOverlay));
  $('category-add-form').addEventListener('submit', (e) => void addCategory(e));

  // 確認ダイアログ
  $('btn-confirm-cancel').addEventListener('click', () => {
    confirmAction = null;
    closeOverlay(confirmOverlay);
  });
  $('btn-confirm-delete').addEventListener('click', () => void runConfirm());

  // フィードバック
  const fbInput = $<HTMLTextAreaElement>('input-feedback-message');
  const fbSend = $<HTMLButtonElement>('btn-feedback-send');
  $('feedback-btn').addEventListener('click', () => {
    openOverlay(feedbackOverlay);
    fbInput.focus();
  });
  $('btn-feedback-close').addEventListener('click', () => closeOverlay(feedbackOverlay));
  fbSend.addEventListener('click', async () => {
    const msg = fbInput.value.trim();
    if (!msg) {
      showToast('内容を入力してください');
      return;
    }
    if (fbSend.disabled) return;
    fbSend.disabled = true;
    fbSend.textContent = '送信中…';
    const ok = await submitFeedback(msg);
    fbSend.disabled = false;
    fbSend.textContent = '送信する';
    if (ok) {
      fbInput.value = '';
      closeOverlay(feedbackOverlay);
      showToast('送信しました。ありがとうございます！');
    } else {
      showToast('送信に失敗しました。時間をおいてお試しください');
    }
  });

  // 背景クリック・Escで閉じる（編集中のものは確認を挟む）
  const closers: [HTMLElement, () => void][] = [
    [detailOverlay, closeDetail],
    [editorOverlay, requestCloseEditor],
    [cropOverlay, cancelCropper],
    [categoryOverlay, () => closeOverlay(categoryOverlay)],
    [discardOverlay, () => closeOverlay(discardOverlay)],
    [confirmOverlay, () => { confirmAction = null; closeOverlay(confirmOverlay); }],
    [feedbackOverlay, () => closeOverlay(feedbackOverlay)],
  ];
  closers.forEach(([overlay, close]) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 一番手前に開いているものだけ閉じる
    const open = [...closers].reverse().find(([o]) => o.classList.contains('is-open'));
    open?.[1]();
  });
}

bindEvents();
onAuthChange((user) => {
  if (user) {
    if (currentUser?.uid !== user.uid) {
      if (currentUser) endSession();
      startSession(user);
    }
  } else if (currentUser) {
    endSession();
  }
});
