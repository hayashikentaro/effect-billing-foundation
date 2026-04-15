# effect-billing-foundation

TypeScript + Effect で作る、業務アプリ向けの最小基盤です。

狙いは「外はオーダーメイド、内は共通化」です。顧客ごとの差分は入力 adapter と個別ルールに閉じ込めつつ、認証/権限、監査ログ、ワークフロー、AI 呼び出し、外部連携、エラーハンドリング、リトライ、ジョブ化しやすい骨格を育てます。

最初のユースケースは請求業務です。

- CSV 入力
- Schema による decode / validate / normalize
- Invoice 作成
- 請求送付
- 入金確認
- overdue 判定
- 督促送信
- 監査ログ記録

## 何が入っているか

このリポジトリは、最初の 3 案件を高速に回すための最小実装です。

- 顧客固有 CSV を内部モデルへ正規化する adapter
- `Invoice` / `Payment` / `WorkflowEvent` などの業務型
- `InvoiceRepo` `MailGateway` `PaymentGateway` `AiGateway` などの抽象
- Effect `Layer` による差し替え可能な live 実装
- `importAndSendInvoices` `confirmPayment` `sendReminderIfOverdue` の workflow
- tenant 境界違反、期限日境界、送信失敗後の回帰テスト

DB や HTTP API や UI はまだ入れていません。今は backend の骨格を優先しています。

## 設計方針

- 顧客差分は `adapters/customers` に寄せる
- 外部入力は `Schema` で正規化してから workflow に渡す
- 外部依存は `services` / `layers` に閉じ込める
- 業務フローは `Effect.gen` で読みやすく書く
- AI は workflow の 1 ステップとして扱う
- 失敗は型付きエラーと監査ログを前提に扱う
- 過剰抽象化より、差し替えやすい単純実装を優先する

追加実装時のルールは [AGENTS.md](./AGENTS.md) にまとめています。

## ディレクトリ構成

```text
src/
  adapters/
    customers/   顧客固有の入力差分を吸収
    infra/       汎用の外部入力補助
  app/           実行入口
  domain/        業務型と純粋ルール
  layers/        services の live/test 実装束
  schema/        normalize 後の内部モデル
  services/      外部依存の抽象
  workflows/     Effect 合成で書く業務フロー
test/            workflow と境界条件の回帰テスト
```

## 現在のフロー

1. 顧客 CSV を受け取る
2. `Schema` で decode / validate / normalize する
3. `Invoice` を作成して保存する
4. 請求メールを送る
5. `sent` に遷移し監査ログを残す
6. 入金が確認できたら `paid` に遷移する
7. 支払期限が過ぎた請求だけを `overdue` として扱う
8. AI で督促文面を作り、督促送信後に `reminded` に遷移する

補足:

- tenant 不一致の workflow 実行は型付きエラーで拒否します
- 支払期限当日は overdue にしません
- 送信失敗後の `created` は「未送信」として残り、督促対象にはなりません

## セットアップ

```sh
npm install
```

## 使い方

デモ実行:

```sh
npm run demo
```

型チェック:

```sh
npm run check
```

テスト実行:

```sh
npm test
```

`npm run demo` では、2 件の請求を取り込み、1 件を入金済み、1 件を督促済みにした結果を JSON で出力します。

## 主なファイル

- [`src/app/demo.ts`](./src/app/demo.ts): 動く最小デモ
- [`src/workflows/invoice-workflows.ts`](./src/workflows/invoice-workflows.ts): 共通 workflow
- [`src/adapters/customers/acme-csv.ts`](./src/adapters/customers/acme-csv.ts): 顧客固有 CSV の normalize 例
- [`src/layers/live.ts`](./src/layers/live.ts): in-memory / stub の live 実装
- [`test/invoice-workflow.test.ts`](./test/invoice-workflow.test.ts): 基本フローのテスト
- [`test/invoice-review-regressions.test.ts`](./test/invoice-review-regressions.test.ts): レビュー指摘の回帰テスト

## 2 社目以降の進め方

基本的には共通 workflow を触る前に、まず新しい customer adapter を足します。

- 入力列名やフォーマットが違うなら `src/adapters/customers` に追加する
- 顧客独自ルールが normalize 前後のどちらかで吸収できるか確認する
- Mail/Payment/AI/Repo の接続先が違うなら `services` / `layers` 側で差し替える
- 共通 workflow に入れるべき差分かどうかは、2 社目以降でも再利用するかで判断する

## 今後の候補

- DB 実装の `InvoiceRepo`
- 認証/権限
- ジョブ実行基盤
- webhook / 外部 API 連携
- テナント設定レジストリ
- HTTP API

このリポジトリは「完成品の業務フレームワーク」ではなく、「最初の案件で売れて、2 社目で共通化が進む骨格」として育てる前提です。
