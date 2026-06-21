# AI・アルゴリズム・レイテンシ設計（技術アピール）

就活面接の優劣を**表情・声・発言内容**からリアルタイム判定し、逆転裁判風オーバーレイで表示する。
本ドキュメントは「実装上どこを頑張ったか」を、コードに紐づけてまとめたもの。

---

## 0. 全体パイプライン

複数の非同期センサ（顔/声/STT/LLM）を、それぞれ**異なる更新周期**で動かしながら、
単一の優勢度ゲージへ合流させている。各層の責務を完全に分離しているのが設計の軸。

```
capture/           analysis/              domain/scoring/         store + UI
（生メディア取得）  （特徴量抽出）          （pure TS スコア計算）
─────────────────────────────────────────────────────────────────────────
candidateCamera ─► candidateFaceAnalyzer ─► faceScore ──┐
interviewerScreen► interviewerFaceAnalyzer► faceScore ──┤
candidateMic ────► voiceAnalyzer(Meyda) ──► voiceScore ─┤─► dominanceAggregator ─► useDominanceStore ─► OverlayRoot
candidateMic STT ► fillerDetector ────────► fillerScore ┤   （throttle集約）        （二段階優勢度再計算）   （ゲージ/カットイン）
interviewer STT ─► responseTurnTracker ──► Gemini Flash ┘
```

ポイントは **producer / consumer 分離**。各解析ループ（`faceAnalysisLoop` / `voiceAnalysisLoop` など）は
`dominanceOrchestrator.report*()` を呼ぶだけで、優勢度の再計算ロジックを一切知らない。
Zustand store はグローバルなので React 外のサービス層からも `getState().setScores()` で更新でき、
「センサ → 計算 → 描画」を疎結合に保てる（`dominanceOrchestrator.ts`）。

---

## 1. 優勢度アルゴリズム：二段階（基礎 + LLM補正）

`domain/scoring/dominanceCalculator.ts` が核心。優勢度を**並列加重平均にしなかった**ことが一番の設計判断。

### 第1段階：基礎優勢度（リアルタイム4項目）

| 項目 | 重み | 向き |
|---|---|---|
| 候補者の表情 `candidateFace` | 0.40 | 高いほど優勢 |
| 面接官の表情 `interviewerFace` | 0.20 | 面接官が穏やか＝候補者優勢 |
| 声の焦り `voice` | 0.25 | **反転**（`100 - score`） |
| フィラー `filler` | 0.15 | **反転**（`100 - score`） |

`voice` / `filler` は「焦り・フィラーの多さ」を表す生スコアなので、合成時に `100 - x` で反転する。
反転をどこで行うかを `dominanceCalculator` 側に一元化し、各 analyzer は「悪さ」だけを素直に出力する契約にした。

### 第2段階：LLM補正は「加重平均」ではなく「delta 加算」

```ts
delta = (responseScore - 50) * 0.4   // 中立50からの差分 × 影響度 → 最大 ±20
dominance = clamp(baseDominance + delta)
```

**なぜ並列加重平均にしなかったか**（コードのコメントにも明記）：
- LLM 判定は数秒に1回しか届かない。これを5項目目として常時平均に混ぜると、
  未到達の間ずっと「中立50」で薄める必要があり、**ゲージが常に50へ引っ張られて鈍る**。
- delta 方式なら、LLM が来ない間も4項目だけで優劣がリアルタイムに動き、
  LLM は「上振れ／下振れさせる補正」としてだけ効く。**段階的に効かせられる**のが利点。

### EMA で判定のブレを吸収

1つの質問内で複数回 LLM 判定が届くケースに備え、返答スコアは指数移動平均で蓄積（`alpha = 0.6`、直近重視）。
古い判定は自然に減衰する（`accumulateResponseScore`）。store の `setScores` がこの蓄積状態を保持する。

---

## 2. 各特徴量のスコアリング設計

### 表情（`faceScore.ts` / `candidateFaceAnalyzer.ts`）
MediaPipe FaceLandmarker のランドマークから「笑顔度 `smileLevel`」「緊張度 `tensionLevel`」を推定し、
`落ち着き(100 - tension) × 0.5 + 笑顔 × 0.5` に表情ラベル補正（smile +10 / tense -10 / surprised -5）を加算。
候補者・面接官で同じ式を使い、面接官側は「面接官が穏やか＝候補者が優勢」という仮定でそのまま流用している。

### 声（`voiceScore.ts` / `voiceAnalyzer.ts`）
Meyda で `rms / zcr / spectralCentroid / buffer` を抽出し、3指標を合成：

- **pauseRatio**（0.4）：RMS が閾値未満の無音フレーム比率＝間の多さ
- **pitchVariation**（0.3）：**自己相関法**で基本周波数を推定し、その**変動係数**を正規化（抑揚の乏しさ＝焦り）
- **speechRate**（0.3）：理想発話速度6からの逸脱（早口/遅すぎを両方ペナルティ）

ピッチは `pitchMinHz=80 / maxHz=500` の範囲でラグ探索する自己相関 + `5秒ローリングウィンドウ`で算出。
Meyda 初期化に失敗しても**フォールバックアナライザ**へ自動退避し、パイプラインを止めない。

### フィラー（`fillerDetector.ts`）
日本語フィラーの**表記ゆれ**（えっと/ええと/えーと/えと、うーん/んー…）を辞書化。

- **長い語から先にマッチして除去** → 「あのー」を「あの」として二重計上しない
- 「ま・と・こう」等の超短語は誤検出源なので**あえて辞書から外す**
- `windowMs = 10秒`で集計 → フィラーを言わなくなれば時間経過でスコアが下がり、**ゲージが揺れ動く**

---

## 3. AI設計：Gemini Flash による返答内容判定

`src/main/llm/geminiJudgeClient.ts`。**API キーは main プロセスのみ**で扱い、renderer には結果だけ IPC で返す（秘密鍵境界）。

### 構造化出力で不安定さを排除
自然文をパースすると壊れやすいので、`responseMimeType: application/json` +
`responseSchema`（`score: 0-100 整数`, `reason: string`）を渡し、**そのままスコア計算層に流せる JSON** で受け取る。
`propertyOrdering` で出力順を固定し、パース・デバッグを安定化。`temperature: 0.2` で判定のブレを抑制。

### REST 直叩き
SDK はバージョンで仕様が変わりやすいため、依存を増やさず REST を直接呼ぶ。
モデルは安定版 `gemini-2.5-flash`（旧 `2.0-flash` は generateContent が 404 になるため切り替え済み）。

### 3段フォールバックで「必ず動く」
1. `LLM_FAKE` … 回答長・キーワードからの**決定的モック**（CI/オフラインで非定数値を確認）
2. `GEMINI_API_KEY` 未設定 … 中立スタブ（score 50）
3. 実 API … 失敗時も呼び出し側で中立スコアにフォールバックし、UI/Store を止めない

---

## 4. 自動判定オーケストレーション（STT → LLM 自動連携）

「面接官の質問 × 就活生の回答」を**沈黙検知で自動的にターン化**して LLM に投げる
（手動ボタン不要）。話者を分けるため STT を2系統同時に動かす。

### `responseTurnTracker.ts` — ターン管理
- `setQuestion()`：新しい質問＝新ターン開始（前の回答蓄積をリセット）
- `addAnswer()`：回答セグメントを蓄積し、沈黙タイマーを張り直す
- **沈黙 2500ms 継続**で発火。`minAnswerLength=4` 未満（「はい」等）は無駄打ちなので発火しない

### `responseJudger.ts` — 過剰リクエスト防止
LLM はトークンコストとレイテンシがあるため、4重ガードで呼びすぎを抑える：
- **in-flight ロック**（判定中の重複呼び出しを弾く）
- **最小間隔 throttle**（1500ms 以内の再呼び出しを弾く）
- **空入力スキップ**
- **同一 質問×回答 の dedup**（直前と同じペアは再判定しない）

失敗時は中立スコア＋理由を返すだけで、optimistic に UI を進める。

---

## 5. レイテンシ設計（リアルタイム性の肝）

「面接中にラグなく優劣が動く」ことが体験の全て。各層で更新周期と非同期化を作り込んでいる。

### LLM のレイテンシを UI に見せない（最重要）
二段階優勢度（§1）の本質的な狙いはここ。**LLM 応答（数秒）を待たずに、
表情・声・フィラーの4項目だけで優勢度ゲージが即座に動く**。
LLM はあとから「補正 delta」として追いついて反映されるので、ユーザーは LLM レイテンシを体感しない。

### STT ストリーミング（`DeepgramSttProvider.ts`）
- Deepgram `nova-2` の **WebSocket ストリーミング** + `interim_results=true` で確定前から文字が出る
- 音声は **250ms チャンク**で PCM16 にエンコードして送信（`encodePcm16` / `ScriptProcessor 4096`）
- **接続確立前のチャンクはキューに退避**し、open 後に順序を保って flush（最初の発話を取りこぼさない）
- 無音時のアイドル切断を防ぐ **KeepAlive を 8秒間隔**で送出
- `filler_words=true` でフィラーを除去させず、フィラー検出の入力源として生に近い transcript を確保

### 解析ループの throttle
- 顔解析：**6fps**（`setTimeout + requestAnimationFrame` で描画フレームに同期、過負荷を回避）
- 声解析：**500ms 間隔**
- STT 用マイクと声解析用マイクは**別ストリーム**にして互いに干渉させない

### 集約層の throttle（`dominanceAggregator.ts`）
顔/声/フィラー/返答は更新周期がバラバラ。これを **leading + trailing throttle（最小100ms）**でまとめ、
優勢度の再計算と React 再描画の頻度を制御する。間隔が空いていれば即時反映、
詰まっていれば末尾で1回だけまとめて反映＝**取りこぼさず、かつ描画を溢れさせない**。

### 各 API の打ち切り
LLM 呼び出しは `AbortSignal.timeout(10s)` で打ち切り、IPC の無期限ハングを防ぐ。

---

## 6. テスト・堅牢性

`domain/scoring/` と各サービスは pure TS / DI 構成で、`now()` やタイマー・fetch を差し替え可能にし、
**時間依存ロジック（throttle・沈黙検知・EMA・ウィンドウ集計）まで決定論的にユニットテスト**している
（`dominanceCalculator.test.ts` / `responseJudger.test.ts` / `responseTurnTracker.test.ts` / `voiceAnalyzer.test.ts` ほか）。
