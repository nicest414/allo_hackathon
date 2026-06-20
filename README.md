
# 就活面接 優劣判定オーバーレイ（仮）

## 概要

就活の面接中に、リアルタイムで「優勢/劣勢」を判定し、逆転裁判風のUIでオーバーレイ表示するデスクトップアプリ。

- Web会議（Zoom等）の画面に重ねて表示する
- 就活生・面接官それぞれの状態（表情・声・発言内容）から優勢度を算出する
- 優勢度が振り切れた時にカットイン演出を入れる

## 開発環境セットアップ

ツールバージョンは [mise](https://mise.jdx.dev/) で統一している（Node は `mise.toml` で **22 (LTS)** に固定。ローカルと CI が同じ定義を参照する）。

```bash
# 1. mise を導入（未インストールの場合）
brew install mise
# シェルに有効化（zsh の例。詳細は mise のドキュメント参照）
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc && exec zsh

# 2. プロジェクト直下で設定を信頼して Node 22 を導入
mise trust      # mise.toml を初回のみ信頼する（セキュリティ機能）
mise install

# 3. 初回セットアップ（依存インストール + .env 作成）
mise run setup
#   → npm ci と、.env.example からの .env 作成を行う（既存の .env は上書きしない）
#   → 作成された .env に各自の API キー（GEMINI_API_KEY 等）を記入する
```

日常の開発タスク：

```bash
mise run dev        # 開発起動（electron-vite dev）
mise run test       # テスト（vitest）
mise run typecheck  # 型チェック
mise run build      # ビルド
```

> 音声ループバック取得など一部機能は macOS 前提（ScreenCaptureKit）。詳細は下記「技術選定」を参照。

### LLM（Gemini判定）のデバッグ

`src/main/llm/geminiJudgeClient.ts` は Electron 非依存なので、アプリを起動せず素の Node で判定を試せる。

```bash
# 質問と回答を渡して判定（モードは自動判定: 下記参照）
mise run judge -- "志望動機は？" "御社の理念に共感し、前職での具体的な実績があります"

mise run judge -- "質問" "回答" -v       # 送信プロンプトと生JSON応答も表示
mise run judge -- "質問" "回答" --debug   # status/レイテンシ等を stderr に出力
mise run judge -- --file scripts/fixtures/cases.json   # {question, answer} 配列をバッチ実行
```

判定モードは環境変数で切り替わる（`judgeResponse` のロジック）：

| 条件 | モード | 用途 |
|---|---|---|
| `LLM_FAKE=1` | モック | 実APIを呼ばず、入力に応じた**決定的**スコア。キー無し/オフライン/CI/UI結合確認 |
| `GEMINI_API_KEY` 設定済み | 実API | 本物の Gemini Flash 判定 |
| どちらも無し | スタブ | 中立50点（フォールバック） |

- `LLM_DEBUG=1` で Gemini 呼び出しの status・レイテンシ・生応答テキストを stderr に出力（**API キーは出力しない**）。
- エラー経路（HTTPエラー/タイムアウト/不正JSON）は `geminiJudgeClient.test.ts` が fetch をモックして再生する（実APIキー不要）。
- main プロセスにブレークポイントを張りたい場合は `npx electron-vite dev --inspect` で起動し、`chrome://inspect` や VS Code からアタッチする。
APIキー（`GEMINI_API_KEY` / `DEEPGRAM_API_KEY`）の取得手順・無料枠・`STT_PROVIDER` の
必須キー・安全な共有方法は **[docs/development-setup.md](docs/development-setup.md)** を参照。

## 入力

| 項目 | 取得元 | 対象 |
|---|---|---|
| 顔の焦り具合 | MediaPipe Face Landmarker | 就活生・面接官両方 |
| 顔の表情 | MediaPipe Face Landmarker | 就活生・面接官両方 |
| 笑顔 | MediaPipe Face Landmarker | 就活生・面接官両方 |
| 声の焦り | Meyda（ピッチ変動・発話速度・ポーズ比） | 就活生 |
| 「えっとですね」検出 | STT + 文字列マッチング | 就活生 |
| 質問の返答内容 | STT → Gemini Flash判定 | 就活生 |

## 出力

| 項目 | 形式 |
|---|---|
| 優勢度 | 0〜100の整数 |
| （今後追加予定の出力） | 未定 |

## UI要件

- 逆転裁判風のUI（優勢/劣勢ゲージ表示）
- オーバーレイ表示（他アプリの上に重ねる、常に最前面、背景透過）
- 優勢度が振り切れた時にカットイン演出を入れる

## 技術選定

アーキテクチャの妥当性、採用理由、代替案、今後の判断基準は [docs/architecture.md](docs/architecture.md) にまとめている。

### シェル：Electron

**選定理由**：オーバーレイ（他アプリの上への重ね表示、常に最前面、背景透過、クリック透過）はブラウザのサンドボックス内では実現不可能。OSネイティブのウィンドウ制御APIを叩く必要があり、それを満たす選択肢としてElectronを採用。

**Tauriとの比較で採用した理由**：音声ループバック取得に`electron-audio-loopback`という既存npmパッケージが使えるため。Tauri採用時はRust側で同等機能を自前実装する必要があり、ハッカソンの時間制約上リスクが高いと判断。

### 出力音声取得：electron-audio-loopback（ScreenCaptureKit）

**選定理由**：面接官の声（Zoom等のアプリが出力する音）はマイクでは拾えないため、PCの出力音声を直接キャプチャする必要がある。

**注意点（未解決）**：ScreenCaptureKitはmacOS専用API。Windows対応する場合は別の仕組み（WASAPI loopback等）が必要で、OSごとの分岐実装が発生する。

### 描画/UI：Vite + React + TypeScript / Rive / framer-motion / howler

**選定理由**：
- React/TS：ライブラリが豊富、状態管理がしやすい。Flutterはカメラ系パッケージの挙動がOSによって差が出やすいため避けた
- Vite：Next.jsは「クライアント/サーバーが別マシンであること」を前提にした機能（SSR, API Routes, SEO最適化等）を提供するが、Electronアプリはmainプロセスがサーバー役を兼ねるため、その前提自体が存在しない。不要な機能を持ち込まずシンプルに保てるため採用
- Rive：逆転裁判風カットイン等のベクターアニメーション
- framer-motion：UIトランジション
- howler：SE/BGM再生（「異議あり！」的な効果音）

### 顔分析：MediaPipe Face Landmarker

**選定理由**：ブラウザ/Node上で動く軽量な顔ランドマーク検出ライブラリ。無料・オフライン動作可。就活生用カメラ映像と面接官用画面フレームの2系統で使用。

**未解決事項**：MediaPipeは座標（ランドマーク）を返すのみで「焦り度」「笑顔度」のスコアは出力しない。眉の動き・瞬き頻度・口角の角度等から指標化するロジックを別途自前で設計する必要がある。

### 声分析：Meyda

**選定理由**：Web Audio APIと連携してリアルタイムに音響特徴量（ピッチ変動・発話速度・ポーズ比）を抽出できる軽量JSライブラリ。Electron上でJS/TSのまま動かせる。

**未解決事項**：MediaPipeと同様、特徴量から「声の焦り」スコアへの変換ロジックは未設計。

### STT：Deepgram streaming（採用決定）

**選定理由**：「質問の返答内容」のテキスト化、「えっとですね」検出には音声のテキスト化が必須。リアルタイムで優勢度を更新するため、streaming対応のSTTが必須。**Deepgram に決定**：純粋なstreaming STTで低レイテンシ、かつ `punctuate=false&smart_format=false` で日本語フィラー（えっと/あの等）を整形させず生に近く残せるため、フィラー検出の入力源に適する（Geminiは整形してフィラーを落とすリスクがあった）。

**実装**：`src/main/stt/DeepgramSttProvider.ts`（Node 22 の global WebSocket でサブプロトコル認証 `['token', key]`）。`DEEPGRAM_API_KEY` 未設定 / `STT_FAKE=1` のときは `DummySttProvider` にフォールバック（無キー/オフライン/CIでパイプライン確認可）。

### 返答内容判定：Gemini Flash + responseSchema

**選定理由**：LLMの自然文の出力をそのままパースするのは不安定なため、`responseSchema`でJSON形式の出力を強制し、優勢度計算ロジックにそのまま代入できる数値・ラベルとして受け取る。

**設計上の重要事項**：mainプロセスから呼び出す。APIキーをrendererプロセスに置かない（rendererはDevToolsで覗けるため）。

### 状態管理：Zustand（ローカルのみ）

**選定理由**：同期基盤（Firebase等）は不要。単一プロセス内のリアルタイム状態管理として、Reduxほどの複雑さを必要としないため軽量なZustandを採用。

## 未確定・要検討事項

- [x] STT: Deepgram streaming vs Gemini Live STT の最終決定 → **Deepgram に決定**（フィラー保持・低レイテンシ）
- [ ] 顔の焦り度・笑顔度のスコアリングロジック設計（MediaPipeのランドマーク座標→数値化）
- [ ] 声の焦りのスコアリングロジック設計（Meydaの特徴量→数値化）
- [ ] 優勢度（0〜100）の計算ロジック（各入力をどう重み付けして合成するか）
- [ ] カットインが入る「振り切れた」条件の定義
- [ ] Windows対応時の音声ループバック実装方法（ScreenCaptureKitはmacOS専用）
- [ ] Gemini呼び出しのタイミング（発言の文末検出と連動 or 一定間隔でバッチ）

## ディレクトリ構成

Electronのmain/preload/rendererで責務を分離し、さらにrenderer内では「ブラウザAPIでの取得」「特徴量抽出」「IPC窓口」「優勢度ロジック」「UI」を分けている。

```
allo_hackathon/
├── .env.example                          # 必要な環境変数名の一覧（実体は.envに、.gitignore済み）
├── .gitignore                            # node_modules/dist/out/.env を除外
├── package.json / electron.vite.config.ts / tsconfig*.json   # ビルド設定
│
├── src/main/                             # ===== Electron main：OS API・秘密鍵を扱う唯一の場所 =====
│   ├── index.ts                          # main entry。BrowserWindow生成・ライフサイクル管理
│   ├── env.ts                            # .env読込・APIキーをmain内に閉じ込める（★ここ以外でキーを読まない）
│   ├── windows/createOverlayWindow.ts    # オーバーレイ用ウィンドウ設定（transparent/alwaysOnTop/clickThrough）
│   ├── capture/desktopSources.ts         # desktopCapturerで面接官側ウィンドウ（画面）の取得元一覧を提供
│   ├── audio/enableLoopbackAudio.ts      # electron-audio-loopbackの有効化（面接官の出力音声キャプチャ許可）
│   ├── stt/
│   │   ├── SttProvider.ts                # ★STT共通インターフェース（差し替えポイント本体）
│   │   ├── DeepgramSttProvider.ts        # Deepgram streaming実装
│   │   └── createSttProvider.ts          # STT_PROVIDER環境変数で実装を選ぶファクトリ
│   ├── llm/
│   │   ├── geminiJudgeClient.ts          # Gemini Flash呼び出し（返答内容判定）。APIキーはここでのみ使用
│   │   └── responseSchema.ts             # responseSchema定義（構造化出力の形）
│   └── ipc/
│       ├── sttIpc.ts                     # renderer⇄main：音声chunk受信→STT結果送信のipcMainハンドラ
│       └── llmIpc.ts                     # renderer⇄main：判定リクエスト受信→結果送信のipcMainハンドラ
│
├── src/preload/index.ts                  # ===== contextBridgeで安全なAPIのみ公開。キー類は一切渡さない =====
│
├── src/renderer/                         # ===== Vite + React + TS：描画とブラウザAPI =====
│   ├── index.html / src/main.tsx / src/App.tsx / src/vite-env.d.ts
│   ├── src/capture/                      # ブラウザAPIでの生メディア取得（解析はしない）
│   │   ├── candidateCamera.ts            # 就活生カメラ映像（getUserMedia）
│   │   ├── candidateMic.ts               # 就活生マイク音声（Meyda/STT入力）
│   │   └── interviewerScreen.ts          # 面接官側画面フレーム（desktopCapturer経由）
│   ├── src/analysis/                     # 特徴量抽出（MediaPipe/Meydaのラッパー）
│   │   ├── face/faceLandmarker.ts        # MediaPipe Face Landmarker共通ラッパー
│   │   ├── face/candidateFaceAnalyzer.ts # 就活生カメラ映像に適用
│   │   ├── face/interviewerFaceAnalyzer.ts # 面接官画面フレームに適用
│   │   └── voice/voiceAnalyzer.ts        # Meydaでピッチ変動・発話速度・ポーズ比を抽出
│   ├── src/services/                     # mainとのIPC窓口（ロジックを持たない薄い層）
│   │   ├── sttService.ts                 # STTリクエスト送信/transcript受信（プロバイダ非依存）
│   │   └── llmJudgeService.ts            # LLM判定リクエスト送信/結果受信
│   ├── src/domain/scoring/               # ★UIから分離したスコア計算ロジック（pure TS、Reactに依存しない）
│   │   ├── faceScore.ts                  # 顔ランドマーク→焦り/表情/笑顔スコア
│   │   ├── voiceScore.ts                 # Meyda特徴量→声の焦りスコア
│   │   ├── fillerDetector.ts             # 「えっとですね」等フィラー検出
│   │   ├── responseScore.ts              # Gemini判定結果→返答内容スコア
│   │   └── dominanceCalculator.ts        # 各スコアを合成して優勢度（0-100）を算出
│   ├── src/store/useDominanceStore.ts    # Zustand（優勢度・各スコアのローカル状態のみ保持。計算はしない）
│   ├── src/ui/                           # Reactコンポーネント（状態を読んで描画するだけ）
│   │   ├── overlay/OverlayRoot.tsx       # オーバーレイ全体レイアウト
│   │   ├── overlay/DominanceGauge.tsx    # 逆転裁判風 優勢/劣勢ゲージ
│   │   └── cutin/CutinPlayer.tsx         # 優勢度振り切れ時のカットイン（Rive再生、howlerでSE）
│   └── src/assets/rive/cutin.riv, assets/sound/objection.mp3   # アニメ/音声アセット置き場
│
└── src/shared/types/                      # ===== main/preload/rendererで共有する型定義 =====
    ├── ipc.ts                             # IPCチャネル名・ペイロード型（契約）
    └── analysis.ts                        # 顔/声/STT/LLM結果・スコアの共通型
```

### 各分析項目の対応

| 分析項目 | 担当ディレクトリ |
|---|---|
| 顔分析（就活生/面接官 2系統） | `renderer/src/analysis/face/` |
| 声分析 | `renderer/src/analysis/voice/` |
| STT | 実装：`main/stt/`、IPC窓口：`main/ipc/sttIpc.ts` + `renderer/src/services/sttService.ts` |
| LLM判定 | `main/llm/`（API呼び出し）+ `renderer/src/services/llmJudgeService.ts`（呼び出し窓口） |
| 優勢度計算ロジック | `renderer/src/domain/scoring/` |
| UI（オーバーレイ/カットイン） | `renderer/src/ui/` |

### 設計判断の理由

- **STT差し替え**：`main/stt/SttProvider.ts` を共通インターフェースとし、`DeepgramSttProvider` / `DummySttProvider` がそれを実装。`createSttProvider.ts` が `.env` の `STT_PROVIDER` で実体を選択するファクトリ。renderer側は `services/sttService.ts` を通じて「transcriptイベントが流れてくる」ことしか知らないため、プロバイダ切り替えはmain側のファイル追加・factory変更だけで完結する。
- **APIキー管理**：`.env.example` にキー名を列挙し、実体の `.env` は `.gitignore` 済み。読み込むのは `main/env.ts` のみで、preload・rendererのどのファイルにもキーを渡さない。renderer→mainは「音声データを送る/判定して」という依頼のみをIPC経由で送り、結果だけを受け取る。
- **優勢度ロジックの分離**：`domain/scoring/` 配下はReact/Electron非依存のpure TS関数群にし、`store/useDominanceStore.ts` がそれらを呼んで結果を保持、`ui/` はstoreを読むだけにする。スコア計算ルールを変えてもUIコンポーネントには触れない。
