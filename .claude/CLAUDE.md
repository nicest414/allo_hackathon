# allo_hackathon

就活面接の優劣を表情・声・発言内容からリアルタイム判定し、逆転裁判風のオーバーレイで表示するElectronデスクトップアプリ（ハッカソン作品）。詳細な仕様・技術選定の理由は [README.md](../README.md) を参照。本ファイルは実装時に守るべき制約と現状の進捗のみをまとめる。

## 現状（重要）

ディレクトリ構成のみが用意された骨組み段階。`src/` 以下の全ファイル、`package.json`、`tsconfig*.json`、`electron.vite.config.ts` は中身が空のスタブ（0バイト）。依存関係未定義のため `npm install` / ビルド / 実行は現時点でできない。実装に着手する際は、まず `package.json`（Electron + Vite + React + TypeScript構成）と各 `tsconfig*.json` を整備すること。

## アーキテクチャ上の制約（README.mdの設計判断より、必ず守る）

- **APIキーはmainプロセスのみ**：`GEMINI_API_KEY` / `DEEPGRAM_API_KEY` は `src/main/env.ts` でのみ読み込む。`preload` / `renderer` にはキーを一切渡さない。Gemini呼び出しは `src/main/llm/`、STT実装は `src/main/stt/` に置き、renderer側はIPC経由で結果だけを受け取る。
- **STTはプロバイダ差し替え可能にする**：`src/main/stt/SttProvider.ts` を共通インターフェースとし、`DeepgramSttProvider` / `GeminiLiveSttProvider` が実装、`createSttProvider.ts` が `.env` の `STT_PROVIDER`（`deepgram` | `gemini_live`）で実体を選ぶ。renderer側 (`renderer/src/services/sttService.ts`) はプロバイダを意識せず「transcriptイベントを受け取る」ことしか知らない。
- **優勢度ロジックはUI/Electronから独立させる**：`renderer/src/domain/scoring/` 配下はReactに依存しないpure TS関数群にする。`store/useDominanceStore.ts` がそれらの結果を保持するだけ、`ui/` 配下はstoreを読んで描画するだけ。スコア計算ルールの変更でUIコンポーネントに触れないようにする。
- **解析とキャプチャを分離**：`renderer/src/capture/`（getUserMedia等の生メディア取得）と `renderer/src/analysis/`（MediaPipe/Meydaでの特徴量抽出）は責務を分ける。

## 環境変数

`.env.example` に必要なキー名を列挙済み。実体の `.env` は `.gitignore` 対象なので各自で作成する。

## 利用可能なスラッシュコマンド（`.claude/commands/`）

- `/commit_and_push`：変更をwhyベースの単位に分類し、ユーザー承認後にコミット・プッシュ。
- `/create-pr`：差分からPRタイトル・説明文を生成し、ユーザー承認後に `gh pr create`。
- `/review-pr <PR番号>`：PRをレビュー。⚠️ 現在の内容はFlutter/Riverpod/Clean Architecture前提のレビュー観点になっており、本プロジェクト（Electron/React/TypeScript）の構成と一致していない。使う場合は観点を読み替えるか、このプロジェクト用に更新する必要がある。
- `/apply-review <PR番号>`：PRレビューコメントを分類し、修正対象は実装、議論対象は返信ドラフトを作成。

## 未確定・要検討事項（README.mdより）

- STT: Deepgram streaming vs Gemini Live STTの最終決定
- 顔の焦り度・笑顔度、声の焦りのスコアリングロジック設計
- 優勢度（0〜100）の重み付け合成ロジック
- カットインが入る「振り切れた」条件の定義
- Windows対応時の音声ループバック実装（`electron-audio-loopback`のScreenCaptureKit部分はmacOS専用）
