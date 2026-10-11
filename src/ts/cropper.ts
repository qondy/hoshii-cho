import { SquareCrop } from './image';
import { closeOverlay, openOverlay } from './ui';

// 写真を正方形に切り抜く範囲を選ぶダイアログ
// ドラッグで位置、スライダー（PCはホイールも）で拡大率を調整する

const MAX_ZOOM = 3;

const overlay = document.getElementById('crop-overlay') as HTMLElement;
const frame = document.getElementById('crop-frame') as HTMLElement;
const zoomInput = document.getElementById('input-crop-zoom') as HTMLInputElement;
const progressEl = document.getElementById('crop-progress') as HTMLElement;

let natW = 0;
let natH = 0;
let zoom = 1;
// 枠の左上を原点にした、画像の左上の位置（枠に対する割合。枠の大きさが変わっても崩れないように）
let posX = 0;
let posY = 0;
// 読み込み済みの画像要素をそのまま枠に入れて表示する（object URL は読み込み後に破棄済みのため）
let image: HTMLImageElement | null = null;
let resolver: ((crop: SquareCrop | null) => void) | null = null;

const frameSize = (): number => frame.clientWidth || 1;
/** 枠の幅を1としたときの画像の表示サイズ（短辺がちょうど枠に収まる＝zoom 1） */
const dispW = (): number => (natW / Math.min(natW, natH)) * zoom;
const dispH = (): number => (natH / Math.min(natW, natH)) * zoom;

/** 枠の中に余白ができないよう位置を制限する */
function clamp(): void {
  posX = Math.min(0, Math.max(1 - dispW(), posX));
  posY = Math.min(0, Math.max(1 - dispH(), posY));
}

function apply(): void {
  clamp();
  if (!image) return;
  // 枠に対する割合で指定する。キーボードの開閉などで枠の大きさが変わっても、
  // 正方形の写真ならいつも枠いっぱい・中央に表示される
  image.style.width = `${dispW() * 100}%`;
  image.style.height = `${dispH() * 100}%`;
  image.style.left = `${posX * 100}%`;
  image.style.top = `${posY * 100}%`;
}

/** 枠の中心を保ったまま拡大率を変える */
function setZoom(next: number): void {
  const z = Math.min(MAX_ZOOM, Math.max(1, next));
  const cx = (0.5 - posX) / dispW();
  const cy = (0.5 - posY) / dispH();
  zoom = z;
  posX = 0.5 - cx * dispW();
  posY = 0.5 - cy * dispH();
  zoomInput.value = String(z);
  apply();
}

function finish(crop: SquareCrop | null): void {
  closeOverlay(overlay);
  image?.remove();
  image = null;
  const r = resolver;
  resolver = null;
  r?.(crop);
}

function currentCrop(): SquareCrop {
  // 表示上の1（枠の幅）が元画像の何ピクセルにあたるか
  const pxPerUnit = Math.min(natW, natH) / zoom;
  return { sx: -posX * pxPerUnit, sy: -posY * pxPerUnit, size: pxPerUnit };
}

// ===== ドラッグ（マウス・タッチ共通） =====
let dragId: number | null = null;
let lastX = 0;
let lastY = 0;

frame.addEventListener('pointerdown', (e) => {
  dragId = e.pointerId;
  lastX = e.clientX;
  lastY = e.clientY;
  frame.setPointerCapture(e.pointerId);
  frame.classList.add('is-dragging');
});
frame.addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  const f = frameSize();
  posX += (e.clientX - lastX) / f;
  posY += (e.clientY - lastY) / f;
  lastX = e.clientX;
  lastY = e.clientY;
  apply();
});
const endDrag = (e: PointerEvent) => {
  if (e.pointerId !== dragId) return;
  dragId = null;
  frame.classList.remove('is-dragging');
};
frame.addEventListener('pointerup', endDrag);
frame.addEventListener('pointercancel', endDrag);
frame.addEventListener('wheel', (e) => {
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
}, { passive: false });

zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));

document.getElementById('btn-crop-ok')?.addEventListener('click', () => finish(currentCrop()));
document.getElementById('btn-crop-cancel')?.addEventListener('click', () => finish(null));
document.getElementById('btn-crop-close')?.addEventListener('click', () => finish(null));
document.getElementById('btn-crop-reset')?.addEventListener('click', () => {
  zoom = 1;
  zoomInput.value = '1';
  posX = (1 - dispW()) / 2;
  posY = (1 - dispH()) / 2;
  apply();
});

export function isCropperOpen(): boolean {
  return resolver !== null;
}

export function cancelCropper(): void {
  if (resolver) finish(null);
}

/**
 * 切り抜き範囲を選んでもらう。キャンセルされたら null。
 * label は複数枚まとめて選んだときの「1 / 3」表示用
 */
export function chooseSquareCrop(img: HTMLImageElement, label = ''): Promise<SquareCrop | null> {
  if (resolver) finish(null);
  natW = img.naturalWidth;
  natH = img.naturalHeight;
  zoom = 1;
  zoomInput.value = '1';
  // 最初は中央を切り抜く位置にしておく
  posX = (1 - dispW()) / 2;
  posY = (1 - dispH()) / 2;
  image?.remove();
  image = img;
  img.className = 'cropper__image';
  img.alt = '';
  img.draggable = false;
  frame.prepend(img);
  progressEl.textContent = label;
  progressEl.classList.toggle('hidden', !label);
  openOverlay(overlay);
  apply();
  return new Promise((resolve) => {
    resolver = resolve;
  });
}
