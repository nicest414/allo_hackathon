# 動作確認テストチェックリスト（allo_hackathon）

就活面接 優劣判定オーバーレイ（Electron + Vite + React + TS）が「ちゃんと動く」ことを確認するための手動・自動テスト項目集。
PR #62（LLMデバッグ環境）の内容を含む。各項目は上から順に実施すると依存関係なく進められる。

## 凡例

| 記号 | 意味 |
|---|---|
| 🤖 | 自動テスト（`mise run test` 等で検証） |
| 🖐️ | 手動確認（アプリ操作・目視） |
| 🍎 | macOS 前提（ScreenCaptureKit / 最前面まわりは OS 依存） |
| 🔒 | セキュリティ観点（APIキー境界など必須確認） |

> 結果は各 `[ ]` をチェックし、NG はそのまま issue 化する。期待結果と異なる場合は「実際の結果」を追記する。

---

## 0. 前提・環境セットアップ

- [ ] 🖐️ **0-1 mise でツール導入**：`mise trust && mise install` → Node が **v22.x** になる（`mise exec -- node -v` で確認）。
- [ ] 🖐️ **0-2 初回セットアップ**：`mise run setup` → `npm ci` が成功し、`.env` が `.env.example` から生成される（既存 `.env` は上書きされない）。
- [ ] 🔒 **0-3 .env の扱い**：`.env` が `.gitignore` 済みで `git status` に出ないこと。`GEMINI_API_KEY` 等は `.env` のみに記入する。

---

## 1. 静的検査・自動テスト・ビルド・CI

- [ ] 🤖 **1-1 型チェック**：`mise run typecheck` が **エラー0** で完了（node 用 / web 用の 2 系統）。
- [ ] 🤖 **1-2 ユニットテスト**：`mise run test` が **全 pass**（現状 11 ファイル / 58 テスト以上）。失敗ゼロ・スキップ理由の確認。
- [ ] 🤖 **1-3 ビルド**：`mise run build`（= typecheck → electron-vite build）が成功し `out/` に main/preload/renderer が生成される。
- [ ] 🤖 **1-4 CI**：PR を上げると GitHub Actions の **Typecheck / Test / Build** 3 ジョブが green（`jdx/mise-action` 経由 Node 22）。
- [ ] 🤖 **1-5 ドメイン層テストの網羅**：`domain/scoring/`（faceScore / voiceScore / fillerDetector / responseScore / dominanceCalculator）の各 `*.test.ts` が pass。

---

## 2. LLM 判定とデバッグハーネス（PR #62）

`src/main/llm/geminiJudgeClient.ts` は Electron 非依存。`mise run judge` で素の Node から確認する。

### 2.1 モード自動切替

- [ ] 🖐️ **2-1 STUB（キー未設定）**：`.env` の `GEMINI_API_KEY` 空で `mise run judge -- "q" "a"` → `mode: STUB`、score **50**、reason に「GEMINI_API_KEY」を含む。
- [ ] 🖐️ **2-2 FAKE（モック）**：`LLM_FAKE=1 mise run judge -- "志望動機は？" "結論として具体的な実績があります"` → `mode: FAKE`、score が **入力依存で非定数**（具体性キーワードで高め）、reason に `[FAKE]`。
- [ ] 🖐️ **2-3 FAKE 決定性**：同じ入力で 2 回実行 → **同じ score** が返る。
- [ ] 🖐️ **2-4 FAKE フィラー減点**：回答を `"えっと、あの、うーん"` にすると score が明確に下がる。
- [ ] 🖐️ **2-5 LIVE（実API）**：`.env` に有効な `GEMINI_API_KEY` を入れて `mise run judge -- "質問" "回答"` → `mode: LIVE`、0〜100 の妥当な score と日本語 reason が返る。
- [ ] 🖐️ **2-6 バッチ**：`mise run judge -- --file scripts/fixtures/cases.json` → 3 ケースが順に判定される。

### 2.2 観測性（verbose / debug）

- [ ] 🖐️ **2-7 verbose**：`-v` 付き実行で「送信プロンプト」が表示され、buildJudgePrompt の内容（# 質問 / # 就活生の返答）を確認できる。
- [ ] 🖐️ **2-8 debug**：`--debug`（= `LLM_DEBUG=1`）で endpoint・HTTP status・レイテンシ(ms)・生応答テキストが stderr に出る。
- [ ] 🔒 **2-9 キー非漏洩**：2-8 の出力に **API キー文字列・`x-goog-api-key` の値が一切含まれない**こと（`mise run judge ... --debug 2>&1 | grep <キー断片>` が 0 件）。

### 2.3 自動テスト（fetch モック）

- [ ] 🤖 **2-10 経路網羅**：`geminiJudgeClient.test.ts` が 成功(fixture) / HTTP429 / text欠落 / 不正JSON / タイムアウト / FAKE で fetch 未呼び出し、の全ケース pass。
- [ ] 🤖 **2-11 IPC フォールバック**：`llmIpc` が判定失敗時に throw せず、中立スコア + 「判定に失敗しました」を返す（UI を止めない）。

---

## 3. アプリ起動・ライフサイクル 🍎

`mise run dev`（= `electron-vite dev`）で起動して確認。

- [ ] 🖐️ **3-1 起動**：`mise run dev` でアプリが起動し、エラーログ無くオーバーレイが表示される。dev server URL を読み込む。
- [ ] 🖐️ **3-2 音声ループバック初期化**：起動ログに `enableLoopbackAudio` の致命的失敗が無い（`enabled` 以外なら warn が出る＝想定内）。
- [ ] 🖐️ **3-3 IPC ハンドラ登録**：renderer から `window.allo.*` 呼び出しが「No handler registered」にならない（llm / capture / stt / overlay 全チャネル）。
- [ ] 🖐️ **3-4 終了**：ウィンドウを閉じる → `window-all-closed` でアプリが quit する。
- [ ] 🖐️ **3-5 macOS activate**：Dock アイコン再クリックでウィンドウが無ければ再生成される。
- [ ] 🖐️ **3-6 本番ロード**：`mise run build` 後の起動でも renderer（`out/renderer/index.html`）を読み込み表示できる。

---

## 4. オーバーレイウィンドウ挙動 🍎

`createOverlayWindow` の要件確認。

- [ ] 🖐️ **4-1 背景透過**：オーバーレイの背景が透けて、下の他アプリ（Zoom 等）が見える。黒背景が残らない。
- [ ] 🖐️ **4-2 フレームレス**：タイトルバー・枠が無い。
- [ ] 🖐️ **4-3 常に最前面**：他アプリをアクティブにしてもオーバーレイが前面に残る（`screen-saver` レベル）。
- [ ] 🖐️ **4-4 全ワークスペース/フルスクリーン上**：別 Space やフルスクリーンの Zoom 上でも表示される（`visibleOnFullScreen`）。
- [ ] 🖐️ **4-5 クリック透過 初期ON**：UI の無い領域では、オーバーレイ越しに下のアプリをクリック操作できる。
- [ ] 🖐️ **4-6 クリック透過 解除（hover）**：操作パネル / 返答判定パネルに**マウスを乗せると**クリック透過が切れて、ボタン・入力欄を操作できる。離すと再び透過に戻る。
- [ ] 🖐️ **4-7 プライマリディスプレイ全面**：work area サイズで左上(0,0)起点に全面表示される。

---

## 5. セキュリティ境界 🔒

- [ ] 🔒 **5-1 contextIsolation**：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: false` で preload 経由のみ公開。renderer で `require`/`process` に直接触れない。
- [ ] 🔒 **5-2 公開 API の最小性**：`window.allo` は stt / llm / capture / overlay の定義済みメソッドのみ。余計なものを公開していない。
- [ ] 🔒 **5-3 APIキー非露出**：renderer の DevTools で `window.allo` や any グローバルに `GEMINI_API_KEY` / `DEEPGRAM_API_KEY` の値が出てこない（キー読込は `src/main/env.ts` のみ）。
- [ ] 🔒 **5-4 IPC は結果のみ往復**：renderer→main は「判定して/音声chunk」を送るだけで、キーを要求・受信していない。

---

## 6. UI / 状態管理（結線済み E2E）

現状 UI に結線されているのは「優勢度バナー＋手動操作」「返答判定パネル」。

- [ ] 🖐️ **6-1 優勢度バナー**：`DominanceClashBanner` が初期 dominance=50 を表示。
- [ ] 🖐️ **6-2 手動 ±10 / リセット**：「優勢 +10」「劣勢 -10」でバナー値が増減し、**0〜100 でクランプ**される。「リセット」で 50 に戻る。
- [ ] 🖐️ **6-3 スコア一覧**：candidateFace / interviewerFace / voice / filler / response の 5 軸が一覧表示される（初期 50）。
- [ ] 🖐️ **6-4 返答判定パネル（フルE2E）**：質問・返答を手入力 → 「返答を判定」→ 判定中表示の後、`response: <score> — <reason>` が表示され、**Store の response スコアにも反映**される。
  - [ ] 🖐️ **6-4a** FAKE モードで非定数スコアが反映される。
  - [ ] 🖐️ **6-4b** LIVE モードで実 Gemini の結果が反映される。
  - [ ] 🖐️ **6-4c** 空入力ではボタンが disabled。
- [ ] 🖐️ **6-5 throttle/重複**：同じ返答を連続実行しても `responseJudger` がスキップ（過剰な API 呼び出しが起きない）。
- [ ] 🤖 **6-6 store/hook テスト**：`responseJudger.test.ts` などが pass し、skip/ok/error の分岐を担保。

---

## 7. STT プロバイダ切替（モジュール）

UI への話者分離結線は未実装。プロバイダ選択ロジックを単体確認する。

- [ ] 🖐️ **7-1 既定**：`STT_PROVIDER` 未設定で `createSttProvider` が `deepgram` 実装を返す。
- [ ] 🖐️ **7-2 不正値**：`STT_PROVIDER=gemini_live` / `foo` で env 読込時に分かりやすいエラーになる。
- [ ] 🖐️ **7-4 抽象境界**：renderer 側 `sttService` が Deepgram/Gemini を直接 import せず、`transcript` 受信のみに依存している（コードレビュー）。

---

## 8. キャプチャ（モジュール）🍎

UI 未結線。取得系を単体で確認する。

- [ ] 🖐️ **8-1 カメラ**：`candidateCamera`（getUserMedia）でカメラ権限ダイアログが出て映像ストリームを取得できる。
- [ ] 🖐️ **8-2 マイク**：`candidateMic` でマイク権限が取れ、音声ストリームを取得できる。
- [ ] 🖐️ **8-3 画面ソース一覧**：`capture.listDesktopSources()`（main の `desktopSources`）が面接官側ウィンドウ/画面の一覧を返す。
- [ ] 🖐️ **8-4 面接官画面フレーム**：`interviewerScreen` が選択ソースからフレームを取得できる。

---

## 9. 解析（モジュール）

- [ ] 🤖 **9-1 顔解析テスト**：`faceAnalyzer.test.ts` が pass（ランドマーク→焦り/笑顔指標の変換）。
- [ ] 🤖 **9-2 声解析テスト**：`voiceAnalyzer.test.ts` が pass（Meyda 特徴量→声の焦り）。
- [ ] 🖐️ **9-3 顔ランドマーク実動作**：MediaPipe Face Landmarker がカメラ映像でランドマークを返す（実機・要モデルロード）。
- [ ] 🖐️ **9-4 音響特徴量実動作**：Meyda がマイク入力からピッチ変動等を出力する。

---

## 10. 優勢度ドメイン（自動中心）

- [ ] 🤖 **10-1 重み合成**：`calculateDominance` が 5 軸 × `DOMINANCE_WEIGHTS`（0.3/0.15/0.2/0.15/0.2）で 0〜100 を返す。
- [ ] 🤖 **10-2 反転処理**：voice / filler は「値が大きいほど焦り」なので `100 - value` で反転して積まれる。
- [ ] 🤖 **10-3 クランプ**：各軸・合成値が 0〜100 にクランプされる。
- [ ] 🤖 **10-4 フィラー検出**：`fillerDetector` が「えっとですね」等を検出する（`fillerDetector.test.ts`）。

---

## 11. 既知の未実装 / 本チェック対象外

以下は現時点でスタブ or 未結線。テスト失敗ではなく「未実装」として扱う。

- ⛔ **カットイン演出**：`ui/cutin/CutinPlayer.tsx` は空（Rive 再生・「異議あり！」SE 未実装）。優勢度振り切れ時の演出は未確認。
- ⛔ **面接官側 顔解析**：`interviewerFaceAnalyzer.ts` は最小スタブ。
- ⛔ **STT→UI 全結線**：話者分離・transcript からの自動判定パイプラインは UI 未結線（現状は返答判定パネルの手入力のみ）。
- ⛔ **カメラ/声スコアの自動 store 反映**：解析→ `useDominanceStore` への定期反映フローは未結線。
- ⚠️ **Windows 対応**：音声ループバック（ScreenCaptureKit）・最前面挙動は macOS 前提。Windows は別 issue。

---

## 付録：トラブルシュート

| 症状 | 確認ポイント |
|---|---|
| `mise install` がエラー | `mise trust` を実行したか |
| 判定が常に 50 | `GEMINI_API_KEY` 未設定（STUB）か、`LLM_FAKE=1` のままか |
| 透過しない・黒背景 | macOS か。`transparent`/`backgroundColor:#00000000` が効いているか |
| パネルが操作できない | hover でクリック透過が解除されるか（4-6） |
| CI だけ落ちる | Node が mise.toml の 22 で動いているか、`npm ci` のロック整合 |
