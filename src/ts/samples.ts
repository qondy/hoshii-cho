import { Priority, Status } from './types';

export interface SampleItem {
  name: string;
  categoryName: string;
  price: number;
  priority: Priority;
  status: Status;
  reason: string;
  memo: string;
}

export const SAMPLE_ITEMS: SampleItem[] = [
  {
    name: 'ノイズキャンセリングヘッドホン',
    categoryName: 'ガジェット',
    price: 38000,
    priority: 3,
    status: 'plan',
    reason: '通勤電車で音楽に集中したい。在宅の作業でも使いたい。',
    memo: 'カラーはブラック。2社を比較中。ケース付きのモデルを選ぶ。セール時期を待つ。',
  },
  {
    name: 'ハンドドリップのセット',
    categoryName: 'キッチン',
    price: 6800,
    priority: 2,
    status: 'want',
    reason: '朝のコーヒーをゆっくり淹れてみたい。',
    memo: 'ドリッパーとサーバーが一緒になったタイプ。ペーパーフィルターのサイズに注意。',
  },
];
