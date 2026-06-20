# PR レビュー（Electron / React / TypeScript）

指定された Pull Request を、本プロジェクト（`allo_hackathon`：Electron + Vite + React + TS のオーバーレイアプリ）のアーキテクチャ制約に沿ってレビューしてください。制約の根拠は [`.claude/CLAUDE.md`](../CLAUDE.md) と [`README.md`](../../README.md) を参照。

## 使い方

```
/review-pr <PR番号>
```

## レビュー手順

1. `gh pr view $ARGUMENTS --json title,body,headRefName,baseRefName,files` で概要・変更ファイルを取得
2. `gh pr diff $ARGUMENTS` で差分を確認
3. 変更が大きい / アーキ制約への影響が広い場合は、`electron-architecture-reviewer` サブエージェントを起動して制約違反を機械的に洗い出す
4. 以下の観点でレビューを実施

## レビュー観点

### 1. 秘密鍵の境界（最優先・厳守）
- API キー（`GEMINI_API_KEY` / `DEEPGRAM_API_KEY`）の読み込みが `src/main/env.ts` 以外に現れていないか
- `src/preload/` `src/renderer/` にキーや `.env` の値が一切渡っていないか（DevTools で覗けるため致命的）
- Gemini 呼び出し（`src/main/llm/`）と STT 実装（`src/main/stt/`）が main プロセス側にあるか。renderer から直接外部 API を叩いていないか
- `.env` 実体がコミットに混入していないか

### 2. 責務分離（README の設計判断）
- `src/renderer/src/domain/scoring/` 配下が pure TS（React / Electron に非依存）か。`import React`・`window`・IPC 依存が混ざっていないか
- `store/useDominanceStore.ts` が状態の**保持のみ**で、スコア計算ロジックを持っていないか（計算は `domain/scoring/`）
- `src/ui/` 配下が store を読んで描画するだけか。スコア計算やキャプチャ処理が混ざっていないか
- `renderer/src/capture/`（生メディア取得）と `renderer/src/analysis/`（MediaPipe/Meyda 特徴量抽出）が分離されているか

### 3. STT プロバイダ差し替え
- STT 実装が `src/main/stt/SttProvider.ts` の共通インターフェースを実装しているか
- プロバイダ選択が `createSttProvider.ts`（`STT_PROVIDER` 環境変数）に集約されているか
- renderer 側（`services/sttService.ts`）が特定プロバイダ（Deepgram/Gemini）を直接参照していないか。「transcript を受け取る」抽象だけに依存しているか

### 4. IPC / 共有型
- IPC のチャネル名・ペイロード型が `src/shared/types/` に集約され、main / preload / renderer が同じ型契約を共有しているか
- preload は `contextBridge` で安全な API のみ公開しているか（`nodeIntegration` 直開放等になっていないか）

### 5. コード品質・安全性
- `npm run typecheck`（`tsc --noEmit`）が通る型安全性。`any` の濫用がないか
- 非同期処理（getUserMedia / STT ストリーム / Gemini 呼び出し）のエラーハンドリングが適切か
- デバッグ用の `console.log` が残っていないか
- 変更に対応するテスト（vitest）が追加・更新されているか

### 6. オーバーレイ / OS 依存
- `transparent` / `alwaysOnTop` / クリック透過などウィンドウ設定が `src/main/windows/createOverlayWindow.ts` に閉じているか
- macOS 専用 API（ScreenCaptureKit 経由の音声ループバック等）に OS 分岐 or 注記があるか

## 出力フォーマット

**概要**
変更内容の要約（何を・なぜ）

**問題点**
- [ ] Critical: 必ず修正が必要（秘密鍵漏洩・責務分離違反・型エラー・バグ）
- [ ] Warning: 修正を推奨
- [ ] Suggestion: 改善提案

**承認判定**
- ✅ LGTM / ⚠️ 要修正 / ❌ 要大幅修正
