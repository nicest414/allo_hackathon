# allo_hackathon

就活面接の優劣を表情・声・発言内容からリアルタイム判定し、逆転裁判風のオーバーレイで表示するElectronデスクトップアプリ（ハッカソン作品）。詳細な仕様・技術選定の理由は [README.md](../README.md) を参照。本ファイルは実装時に守るべき制約と現状の進捗のみをまとめる。

## 現状（重要）

ビルド基盤が整備され、各機能を issue 駆動で並行実装している段階。`package.json`（Electron + Vite + React + TypeScript 構成、Zustand 採用）・`tsconfig*.json`・`electron.vite.config.ts` は整備済みで、以下が実行可能：

- `npm install` — 依存インストール
- `npm run dev` — electron-vite dev server で起動
- `npm run build` — `typecheck` 後にビルド
- `npm run typecheck` — `tsc --noEmit`（node 用 / web 用の 2 系統）
- `npm test` — vitest 実行

`src/` 配下は機能ごとに実装が進行中（一部は空ファイル/スタブのまま）。新規ファイルを追加する際は下記「ディレクトリ構成」の責務分離を守ること。

## ブランチ運用

- 1 ブランチ = 1 issue を原則とする。
- ブランチ名は **`feature/issue-<番号>-<slug>`** に統一する（`/start-issue <番号>` がこの規約でブランチを切る）。
- 着手は `/start-issue` → 実装 → `/commit_and_push` → `/create-pr` の流れ。`create-pr` はブランチ名から `close #<番号>` を自動付与する。

## アーキテクチャ上の制約（README.mdの設計判断より、必ず守る）

- **APIキーはmainプロセスのみ**：`GEMINI_API_KEY` / `DEEPGRAM_API_KEY` は `src/main/env.ts` でのみ読み込む。`preload` / `renderer` にはキーを一切渡さない。Gemini呼び出しは `src/main/llm/`、STT実装は `src/main/stt/` に置き、renderer側はIPC経由で結果だけを受け取る。
- **STTはプロバイダ差し替え可能にする**：`src/main/stt/SttProvider.ts` を共通インターフェースとし、`DeepgramSttProvider` / `GeminiLiveSttProvider` が実装、`createSttProvider.ts` が `.env` の `STT_PROVIDER`（`deepgram` | `gemini_live`）で実体を選ぶ。renderer側 (`renderer/src/services/sttService.ts`) はプロバイダを意識せず「transcriptイベントを受け取る」ことしか知らない。
- **優勢度ロジックはUI/Electronから独立させる**：`renderer/src/domain/scoring/` 配下はReactに依存しないpure TS関数群にする。`store/useDominanceStore.ts` がそれらの結果を保持するだけ、`ui/` 配下はstoreを読んで描画するだけ。スコア計算ルールの変更でUIコンポーネントに触れないようにする。
- **解析とキャプチャを分離**：`renderer/src/capture/`（getUserMedia等の生メディア取得）と `renderer/src/analysis/`（MediaPipe/Meydaでの特徴量抽出）は責務を分ける。

## 環境変数

`.env.example` に必要なキー名を列挙済み。実体の `.env` は `.gitignore` 対象なので各自で作成する。

## チーム用ハーネス構成（`.claude/`）

git 管理された共有設定でチーム全員の挙動を揃えている。

- **`.claude/settings.json`（共有・コミット対象）**：許可 allowlist（`npm run`・`git`・`gh pr/issue` 読み取り系など、安全なコマンドの確認プロンプトを省略）と、秘密鍵ガード hook の登録、`.env` への deny を定義。
- **`.claude/settings.local.json`（個人用）**：各自の好み（githubApi MCP 無効化など）。共有しない。
- **`.claude/hooks/guard-secrets.sh`（PreToolUse ガード）**：`.env`（`.env.example` を除く）への Edit/Read、`cat .env`・`git add .env`・API キーの echo などをブロックする。「API キーは main のみ・`.env` は commit しない」制約を機械的に強制する。
- **`.claude/agents/electron-architecture-reviewer.md`**：差分をアーキ制約に対して監査する read-only レビュアー（`/review-pr` から、または直接呼べる）。

### スラッシュコマンド（`.claude/commands/`）

- `/start-issue <issue番号>`：issue を要約し、`main` 最新化後に `feature/issue-<番号>-<slug>` ブランチを作成。着手の足がかりを提示（実装はユーザー承認後）。
- `/commit_and_push`：変更をwhyベースの単位に分類し、ユーザー承認後にコミット・プッシュ。
- `/create-pr`：差分からPRタイトル・説明文を生成し、ユーザー承認後に `gh pr create`。
- `/review-pr <PR番号>`：本プロジェクト（Electron/React/TS）のアーキ制約（秘密鍵境界・責務分離・STT 差し替え・IPC 契約）でPRをレビュー。
- `/apply-review <PR番号>`：PRレビューコメントを分類し、修正対象は実装、議論対象は返信ドラフトを作成。

## 未確定・要検討事項（README.mdより）

- STT: Deepgram streaming vs Gemini Live STTの最終決定
- 顔の焦り度・笑顔度、声の焦りのスコアリングロジック設計
- 優勢度（0〜100）の重み付け合成ロジック
- カットインが入る「振り切れた」条件の定義
- Windows対応時の音声ループバック実装（`electron-audio-loopback`のScreenCaptureKit部分はmacOS専用）
