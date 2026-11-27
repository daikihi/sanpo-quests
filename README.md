# Sanpo Quests — 週末ウォーク縛りルールジェネレータ

週末の街歩きにランダムな縛りルールと加点・減点スコアメイクを添える、完全フロントエンド完結型の SPA / PWA ミニツールです。

- **公開予定 URL**: `https://daikihi.github.io/sanpo-quests/`
- **バックエンド**: なし（すべてのデータ永続化はブラウザの `localStorage` で完結）

---

## 主な機能

1. **条件設定 & ランダム抽選**
   - 縛り数（`1`〜`3`個）、難易度（`light` / `standard` / `hard`）、公開モード（`open` / `blind_hint` / `blind_secret`）、同行形態（`solo` / `pair`）、除外カテゴリを設定可能。
   - 同一カテゴリの重複防止、排他ルール制御（`excludes`）、直近履歴の重複抑制、ピン留め & 個別リロールに対応。
2. **3 種の公開モード**
   - **オープン (`open`)**: ルール名・条件・配点を見ながらリアルタイム採点。
   - **条件秘匿 (`blind_hint`)**: 抽象ヒントだけを見て歩き、具体的な条件と配点は終了時に開示。
   - **完全シークレット (`blind_secret`)**: ルールを `？？？` で隠し、縛り数と難易度だけで歩いて終了時に一括開示＋振り返り自己採点。
3. **4 種の純粋関数判定機 (Evaluator) & 難易度ウェイト**
   - `manual`（手動達成/違反＋Undo）、`counter`（目標到達加点・上限超過自動減点）、`location_check`（ワンショット現在地と登録済み「よく通る場所」との Haversine 距離判定）、`session_rule`（経過時間・完走判定）。
   - 難易度ごとに加点・減点へ逆方向のウェイトを適用（`light`: `+×0.8 / -×0.6`、`standard`: `+×1.0 / -×1.0`、`hard`: `+×1.4 / -×1.5`）。
4. **地図ビュー（MapLibre GL JS + OpenFreeMap）**
   - API キー不要の無料ベクタータイル（OpenFreeMap）を使用。
   - **鉄道網** と **河川・水辺** の 2 レイヤーを強調表示（5〜10km 圏目安）。
   - ライン上の **進行方向アイコン** を ON/OFF 切替可能（デフォルト `OFF`）。
5. **データ入出力 & PWA**
   - 散歩メモ用テキストコピー、他ミニツール連携用 JSON（`handoffHint` 含む）のコピー / `.json` ダウンロード / インポートに対応。
   - `manifest.webmanifest` と Service Worker によるホーム画面追加・オフライン動作対応。

---

## セットアップ & 開発コマンド

```bash
# 依存パッケージのインストール
npm install

# 開発サーバ起動 (http://localhost:5173/sanpo-quests/)
npm run dev

# 単体テスト実行 (Vitest)
npm test

# 型チェック
npm run typecheck

# 本番ビルド (base: "/sanpo-quests/")
npm run build

# 本番ビルドのローカルプレビュー
npm run preview
```

---

## 遊び方

1. **抽選・編成タブ**: 縛り数・難易度・公開モード・同行形態・除外カテゴリを選んで「この条件で縛りを抽選する」を押します。気に入ったルールは「ピン留め」し、他の枠だけリロールできます。「馴染み場所」から最寄り駅などを登録しておくと距離判定ルールで使えます。
2. **散歩中タブ**: 「この縛りで散歩をスタート」で計測開始。オープン／ヒントモードではカード上のボタンで達成・違反・カウント・現在地チェックを記録（Undo 対応）します。エリアマップで鉄道網や河川の位置も確認できます。
3. **結果・履歴タブ**: 「散歩を終了」すると最終スコアが確定し、ブラインド時は全ルールが一括開示されます（振り返り自己採点の微調整も可能）。散歩メモや連携 JSON をコピー／保存できます。

---

## ディレクトリ構成

```text
sanpo-quests/
├── .github/workflows/deploy.yml   # GitHub Pages 自動デプロイ
├── public/
│   ├── manifest.webmanifest       # PWA マニフェスト
│   ├── sw.js                      # オフライン対応 Service Worker
│   └── icons/                     # アプリアイコン (SVG / PNG)
├── src/
│   ├── data/rules.json            # 初期ルールマスタ (19件)
│   ├── domain/
│   │   ├── types.ts               # 型定義・難易度ウェイト
│   │   ├── generator.ts           # 抽選・排他・ピン留め・テンプレート展開
│   │   ├── evaluator.ts           # 4種 Evaluator・Haversine・Undo
│   │   └── scorer.ts              # スコア算出・内訳集計
│   ├── storage/localStore.ts      # localStorage 永続化・メモ/JSON 入出力
│   ├── map/mapView.ts             # MapLibre GL JS + OpenFreeMap 地図ビュー
│   ├── ui/                        # 3タブ UI & モーダル
│   ├── main.ts
│   └── style.css
└── tests/                         # Vitest 単体テスト
```
