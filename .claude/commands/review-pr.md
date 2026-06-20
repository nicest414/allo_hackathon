# PR レビュー

指定されたPRをレビューしてください。

## 使い方

```
/review-pr <PR番号>
```

## レビュー手順

1. `gh pr view $ARGUMENTS` でPRの概要・説明を取得
2. `gh pr diff $ARGUMENTS` で差分を確認
3. 以下の観点でレビューを実施

## レビュー観点

### アーキテクチャ・依存関係（厳守）
- `features` → 他の `features` を import していないか
- `common` → `features` / `app` を import していないか
- Clean Architecture 移行済みの feature（settings, story, budget, tribute, shop, costume）で data/domain/presentation の境界が守られているか

### コード品質
- Lint ルール違反がないか（`flutter_lints` + `directives_ordering`）
- コード生成ファイル（`.g.dart`, `.freezed.dart`）を手動編集していないか
- 不要な `print` / `debugPrint` が残っていないか

### Riverpod / 状態管理
- Provider スタイルがファイル内で一貫しているか（Manual vs Code-gen）
- `keepAlive` が必要な Provider に設定されているか

### バグ・安全性
- null safety の扱いが適切か
- 非同期処理のエラーハンドリングが適切か
- セキュリティ上の問題がないか

### テスト
- 変更に対応するテストが追加・更新されているか

## 出力フォーマット

レビュー結果を以下の形式で出力してください：

**概要**
変更内容の要約

**問題点**
- [ ] Critical: 必ず修正が必要な問題
- [ ] Warning: 修正を推奨する問題
- [ ] Suggestion: 改善提案

**承認判定**
- ✅ LGTM / ⚠️ 要修正 / ❌ 要大幅修正
