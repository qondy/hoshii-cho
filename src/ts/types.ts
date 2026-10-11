/** 気になる → 買う予定 → 買った / やめた */
export type Status = 'want' | 'plan' | 'bought' | 'dropped';

/** 1=いつか / 2=ほしい / 3=絶対ほしい */
export type Priority = 1 | 2 | 3;

export interface LinkItem {
  label: string;
  url: string;
}

/** 欲しい物の基本情報（写真の本体は別ドキュメント。一覧の読み込みを軽くするため） */
export interface ItemData {
  name: string;
  categoryId: string; // '' は未分類
  price: number | null; // 円。未入力は null
  priority: Priority;
  status: Status;
  wantedAt: string; // 欲しいと思った日 'YYYY-MM-DD' または ''
  buyBy: string; // 買う予定日 'YYYY-MM-DD' または ''
  reason: string; // 欲しい理由
  memo: string; // 自由メモ（サイズ・色・型番・比較した物など）
  links: LinkItem[]; // 買う場所・参考ページ
  thumb: string; // 一覧用の小さな写真（data URL）または ''
  photoCount: number;
}

export interface Item extends ItemData {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  createdAt: number;
}
