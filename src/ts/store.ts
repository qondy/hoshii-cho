import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Category, Item, ItemData, LinkItem, Priority, Status } from './types';
import { isSafeImageDataUrl, MAX_PHOTO_CHARS, MAX_THUMB_CHARS } from './image';

export const MAX_NAME = 60;
export const MAX_REASON = 500;
export const MAX_MEMO = 2000;
export const MAX_LINKS = 3;
export const MAX_LINK_LABEL = 30;
export const MAX_URL = 500;
export const MAX_PHOTOS = 1;
export const MAX_CATEGORY_NAME = 20;
export const MAX_CATEGORIES = 30;
export const MAX_PRICE = 99_999_999;

const DEFAULT_CATEGORIES = ['ガジェット', 'ファッション', 'インテリア', 'キッチン', '本・学び', '趣味'];

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const msOrNull = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);
export const STATUSES: Status[] = ['want', 'plan', 'bought', 'dropped'];

const safeStatus = (v: unknown): Status => (STATUSES.includes(v as Status) ? (v as Status) : 'want');
const safePriority = (v: unknown): Priority => (v === 1 || v === 2 || v === 3 ? v : 2);

/** http/https のURLだけを許可する（javascript: などを弾く） */
export function safeUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > MAX_URL) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

export function safeDate(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

/** 0〜上限の整数（円）だけを受け付ける。それ以外は未入力扱い */
export function safePrice(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE ? Math.floor(v) : null;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normLinks(v: unknown): LinkItem[] {
  if (!Array.isArray(v)) return [];
  const out: LinkItem[] = [];
  v.forEach((m) => {
    if (!m || typeof m !== 'object' || out.length >= MAX_LINKS) return;
    const o = m as Record<string, unknown>;
    const url = safeUrl(o.url);
    if (!url) return;
    out.push({ label: str(o.label, MAX_LINK_LABEL).trim() || 'リンク', url });
  });
  return out;
}

function sanitize(data: ItemData): ItemData {
  return {
    name: data.name.trim().slice(0, MAX_NAME),
    categoryId: data.categoryId.slice(0, 40),
    price: safePrice(data.price),
    priority: safePriority(data.priority),
    status: safeStatus(data.status),
    wantedAt: safeDate(data.wantedAt),
    buyBy: safeDate(data.buyBy),
    reason: data.reason.trim().slice(0, MAX_REASON),
    memo: data.memo.slice(0, MAX_MEMO),
    links: normLinks(data.links),
    thumb: isSafeImageDataUrl(data.thumb, MAX_THUMB_CHARS) ? data.thumb : '',
    photoCount: Math.max(0, Math.min(MAX_PHOTOS, Math.floor(data.photoCount) || 0)),
  };
}

// ============================================================
// Items
// ============================================================
const itemsCol = (uid: string) => collection(db, 'users', uid, 'items');
const itemDoc = (uid: string, id: string) => doc(db, 'users', uid, 'items', id);
const photosDoc = (uid: string, id: string) => doc(db, 'users', uid, 'itemPhotos', id);

export function subscribeItems(
  uid: string,
  onData: (list: Item[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(itemsCol(uid), (snap) => {
    const list: Item[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_NAME).trim();
      if (!createdAt || !name) return;
      list.push({
        id: d.id,
        name,
        categoryId: str(data.categoryId, 40),
        price: safePrice(data.price),
        priority: safePriority(data.priority),
        status: safeStatus(data.status),
        wantedAt: safeDate(data.wantedAt),
        buyBy: safeDate(data.buyBy),
        reason: str(data.reason, MAX_REASON),
        memo: str(data.memo, MAX_MEMO),
        links: normLinks(data.links),
        thumb: isSafeImageDataUrl(data.thumb, MAX_THUMB_CHARS) ? data.thumb : '',
        photoCount: typeof data.photoCount === 'number' ? Math.max(0, Math.min(MAX_PHOTOS, Math.floor(data.photoCount))) : 0,
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
      });
    });
    onData(list);
  }, onError);
}

/** 欲しい物を作成し、写真があれば別ドキュメントに保存する */
export async function createItem(uid: string, data: ItemData, photos: string[]): Promise<string> {
  const now = Date.now();
  const ref = doc(itemsCol(uid));
  const batch = writeBatch(db);
  const clean = photos.filter((p) => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
  batch.set(ref, { ...sanitize({ ...data, photoCount: clean.length }), createdAt: now, updatedAt: now });
  if (clean.length) batch.set(photosDoc(uid, ref.id), { photos: clean });
  await batch.commit();
  return ref.id;
}

/** 基本情報と写真をまとめて更新する（photos が null のときは写真に触らない） */
export async function updateItem(uid: string, id: string, data: ItemData, photos: string[] | null): Promise<void> {
  const batch = writeBatch(db);
  if (photos) {
    const clean = photos.filter((p) => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
    batch.update(itemDoc(uid, id), { ...sanitize({ ...data, photoCount: clean.length }), updatedAt: Date.now() });
    if (clean.length) batch.set(photosDoc(uid, id), { photos: clean });
    else batch.delete(photosDoc(uid, id));
  } else {
    batch.update(itemDoc(uid, id), { ...sanitize(data), updatedAt: Date.now() });
  }
  await batch.commit();
}

/** 状態・優先度だけをすばやく変える（詳細画面のボタン用） */
export function updateQuick(uid: string, id: string, patch: { status?: Status; priority?: Priority }): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.status) data.status = safeStatus(patch.status);
  if (patch.priority) data.priority = safePriority(patch.priority);
  return updateDoc(itemDoc(uid, id), data);
}

export async function deleteItem(uid: string, id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(itemDoc(uid, id));
  batch.delete(photosDoc(uid, id));
  await batch.commit();
}

export async function loadPhotos(uid: string, id: string): Promise<string[]> {
  const snap = await getDoc(photosDoc(uid, id));
  if (!snap.exists()) return [];
  const photos = snap.data().photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter((p): p is string => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
}

// ============================================================
// Categories
// ============================================================
const categoriesCol = (uid: string) => collection(db, 'users', uid, 'categories');
const metaDoc = (uid: string) => doc(db, 'users', uid, 'meta', 'profile');

export function subscribeCategories(
  uid: string,
  onData: (list: Category[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(categoriesCol(uid), (snap) => {
    const list: Category[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_CATEGORY_NAME).trim();
      if (!createdAt || !name) return;
      list.push({ id: d.id, name, createdAt });
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    onData(list);
  }, onError);
}

/** 初回ログイン時だけ、よく使うカテゴリを用意しておく（全部消した後に復活させないようフラグで管理） */
export async function ensureDefaultCategories(uid: string): Promise<void> {
  const meta = await getDoc(metaDoc(uid));
  if (meta.exists() && meta.data().categoriesSeeded === true) return;
  const batch = writeBatch(db);
  const now = Date.now();
  DEFAULT_CATEGORIES.forEach((name, i) => {
    batch.set(doc(categoriesCol(uid)), { name, createdAt: now + i });
  });
  batch.set(metaDoc(uid), { categoriesSeeded: true }, { merge: true });
  await batch.commit();
}

export async function createCategory(uid: string, name: string): Promise<string> {
  const ref = await addDoc(categoriesCol(uid), { name: name.trim().slice(0, MAX_CATEGORY_NAME), createdAt: Date.now() });
  return ref.id;
}

export function renameCategory(uid: string, id: string, name: string): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'categories', id), { name: name.trim().slice(0, MAX_CATEGORY_NAME) });
}

/** カテゴリを削除し、中の欲しい物は未分類に戻す（欲しい物自体は消さない） */
export async function deleteCategory(uid: string, id: string, itemIds: string[]): Promise<void> {
  for (let i = 0; i < itemIds.length; i += 400) {
    const batch = writeBatch(db);
    itemIds.slice(i, i + 400).forEach((iid) => batch.update(itemDoc(uid, iid), { categoryId: '' }));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid, 'categories', id));
}
