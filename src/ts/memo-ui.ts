// メモ欄の入力・表示・その場編集の共通部品（全アプリ共通）。
// ・入力: 文字に合わせて欄が広がる / 残り文字数 / スマホのキーボードで隠れない
// ・表示: URLを自動リンク / 長いメモは「続きを読む」 / 空は「メモを追加」
// ・編集: メモをタップするとその場で編集（保存・キャンセル付き）

const URL_RE = /https?:\/\/[^\s<>"'）)」』]+/g;
const MAX_GROW_VH = 0.55;
const COUNTER_WARN_RATIO = 0.9;

// ============================================================
// 入力欄
// ============================================================
export function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  const limit = Math.round(window.innerHeight * MAX_GROW_VH);
  const next = Math.min(el.scrollHeight + 2, limit);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight + 2 > limit ? 'auto' : 'hidden';
}

function updateCounter(el: HTMLTextAreaElement, counter: HTMLElement | null): void {
  if (!counter) return;
  const max = el.maxLength;
  counter.textContent = `${el.value.length} / ${max}`;
  counter.classList.toggle('is-warn', el.value.length >= max * COUNTER_WARN_RATIO);
}

const watched = new Map<HTMLTextAreaElement, { value: string; refresh: () => void }>();
let watcherStarted = false;

function startWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  window.setInterval(() => {
    watched.forEach((state, el) => {
      if (!el.isConnected) {
        watched.delete(el);
        return;
      }
      if (el.value !== state.value) {
        state.value = el.value;
        if (el.offsetParent !== null) state.refresh();
      }
    });
  }, 400);
}

export function enhanceTextarea(el: HTMLTextAreaElement): void {
  if (el.dataset.memoEnhanced) return;
  el.dataset.memoEnhanced = '1';
  el.classList.add('memo-textarea');

  let counter: HTMLElement | null = null;
  if (el.maxLength > 0 && el.maxLength < 100000) {
    counter = document.createElement('div');
    counter.className = 'memo-counter';
    counter.setAttribute('aria-hidden', 'true');
    el.insertAdjacentElement('afterend', counter);
  }

  const refresh = (): void => {
    autoGrow(el);
    updateCounter(el, counter);
  };

  el.addEventListener('input', refresh);
  el.addEventListener('focus', () => {
    refresh();
    // スマホのキーボードに隠れないよう、入力中の欄を画面内へ
    window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  });
  el.form?.addEventListener('reset', () => window.setTimeout(refresh, 0));

  // モーダル表示・プログラムからの値セットで見た目がずれないよう、幅が変わったら再計算
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (el.offsetWidth !== lastWidth) {
      lastWidth = el.offsetWidth;
      refresh();
    }
  }).observe(el);

  // value が外から書き換えられた場合にも追従（編集フォームを開いた時など）
  watched.set(el, { value: el.value, refresh });

  startWatcher();
  refresh();
}

/** ページ内の textarea をすべて強化し、あとから増えるもの（動的に描画される欄）にも自動で適用する */
export function initTextareas(root: ParentNode = document): void {
  const apply = (scope: ParentNode): void => {
    scope.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(enhanceTextarea);
  };
  apply(root);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node instanceof HTMLTextAreaElement) enhanceTextarea(node);
        else if (node instanceof Element) apply(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// 表示
// ============================================================
/** 文字列をDOMとして安全に組み立てる（innerHTMLを使わない）。URLだけをリンクにする */
export function appendLinkified(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) parent.append(text.slice(last, start));
    const a = document.createElement('a');
    a.href = m[0];
    a.textContent = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'memo-link';
    parent.append(a);
    last = start + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

export interface MemoViewOptions {
  /** 空のときに出す文言。空文字なら何も出さない（編集不可の表示向け） */
  emptyLabel?: string;
  /** 折りたたみ時の行数 */
  clampLines?: number;
}

/** 長いメモを折りたたみ、「続きを読む／閉じる」で開閉できる表示にする */
export function renderMemoView(box: HTMLElement, text: string, opts: MemoViewOptions = {}): void {
  const { emptyLabel = '', clampLines = 4 } = opts;
  box.replaceChildren();
  box.classList.add('memo-view');
  box.classList.remove('is-empty', 'is-clamped', 'is-open');
  box.style.setProperty('--memo-lines', String(clampLines));

  const body = document.createElement('div');
  body.className = 'memo-view__body';
  if (!text.trim()) {
    box.classList.add('is-empty');
    body.textContent = emptyLabel;
    box.append(body);
    return;
  }
  appendLinkified(body, text);
  box.append(body);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'memo-view__toggle hidden';
  toggle.textContent = '続きを読む';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = box.classList.toggle('is-open');
    toggle.textContent = open ? '閉じる' : '続きを読む';
  });
  box.append(toggle);
  box.classList.add('is-clamped');

  const measure = (): void => {
    if (box.classList.contains('is-open')) return;
    const overflow = body.scrollHeight > body.clientHeight + 1;
    toggle.classList.toggle('hidden', !overflow);
  };
  measure();
  // モーダル内など、表示された後に高さが決まる場合に備える
  new ResizeObserver(measure).observe(body);
}

// ============================================================
// その場で編集
// ============================================================
export interface InlineEditOptions {
  maxLength: number;
  placeholder?: string;
  emptyLabel: string;
  getText: () => string;
  /** 保存処理。失敗時は reject する（編集状態を保つ） */
  save: (text: string) => Promise<void>;
  /** 保存に失敗した時に呼ばれる（トースト表示など） */
  onError?: (err: unknown) => void;
  clampLines?: number;
}

export interface InlineEditController {
  /** 外部の値が変わった時に表示を更新する（編集中は入力を守って何もしない） */
  refresh: () => void;
  /** 編集中でも破棄して表示に戻す（別の項目に切り替える時など） */
  reset: () => void;
}

export function makeInlineEditable(box: HTMLElement, opts: InlineEditOptions): InlineEditController {
  let editing = false;
  let saving = false;

  const show = (): void => {
    editing = false;
    box.classList.remove('is-editing');
    renderMemoView(box, opts.getText(), { emptyLabel: opts.emptyLabel, clampLines: opts.clampLines });
    box.classList.add('is-editable');
    box.tabIndex = 0;
    box.setAttribute('role', 'button');
    box.setAttribute('aria-label', 'タップして編集');
  };

  const edit = (): void => {
    if (editing) return;
    editing = true;
    box.classList.add('is-editing');
    box.classList.remove('is-editable', 'is-empty');
    box.removeAttribute('role');
    box.removeAttribute('aria-label');
    box.replaceChildren();

    const ta = document.createElement('textarea');
    ta.value = opts.getText();
    ta.maxLength = opts.maxLength;
    ta.rows = 3;
    if (opts.placeholder) ta.placeholder = opts.placeholder;
    enhanceTextarea(ta);

    const actions = document.createElement('div');
    actions.className = 'memo-edit__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost btn--sm';
    cancel.textContent = 'キャンセル';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary btn--sm';
    save.textContent = '保存';
    actions.append(cancel, save);
    box.append(ta, actions);

    cancel.addEventListener('click', (e) => {
      e.stopPropagation(); // 表示に戻した直後に、外側のクリックで編集が再開しないように
      show();
    });
    save.addEventListener('click', async () => {
      if (saving) return;
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      try {
        await opts.save(ta.value.trim());
        show();
      } catch (err) {
        opts.onError?.(err);
        save.disabled = false;
        cancel.disabled = false;
      } finally {
        saving = false;
      }
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') show();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click();
    });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };

  box.addEventListener('click', (e) => {
    if (editing) return;
    const t = e.target as HTMLElement;
    if (t.closest('a, .memo-view__toggle')) return;
    edit();
  });
  box.addEventListener('keydown', (e) => {
    if (!editing && (e.key === 'Enter' || e.key === ' ') && e.target === box) {
      e.preventDefault();
      edit();
    }
  });

  show();
  return { refresh: () => { if (!editing) show(); }, reset: show };
}
