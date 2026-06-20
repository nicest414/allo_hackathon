# 開発環境セットアップ（APIキー・.env）

STT（音声認識）と返答内容判定（Gemini Flash）は実APIを使う。各メンバーが自分のローカル
`.env` にAPIキーを設定してから動作確認する。`.env` は `.gitignore` 済みで、キーは
Electron main プロセス（`src/main/env.ts`）からのみ読み込まれ、preload / renderer には
渡らない。

## 1. 前提

```bash
npm install
cp .env.example .env   # .env を作成して各キーを記入する
```

## 2. APIキーの取得

### GEMINI_API_KEY（Gemini API / Google AI Studio）

1. https://aistudio.google.com/apikey にGoogleアカウントでアクセス
2. 「Create API key」でキーを発行
3. 発行された文字列を `.env` の `GEMINI_API_KEY=` に貼り付ける

- 用途: 返答内容判定（Gemini Flash）。`STT_PROVIDER=gemini_live` のときはSTTでも使用。
- 料金: 無料枠あり（レート制限つき）。ハッカソンの検証用途は基本的に無料枠で足りる想定。
  ※無料枠の範囲・レート制限は変更され得るため、利用前に上記ページで最新条件を確認する。

### DEEPGRAM_API_KEY（Deepgram）

1. https://console.deepgram.com/signup でアカウントを作成
2. ダッシュボードの「API Keys」から新規キーを発行
3. 発行された文字列を `.env` の `DEEPGRAM_API_KEY=` に貼り付ける

- 用途: `STT_PROVIDER=deepgram` のときのストリーミングSTT。
- 料金: 新規登録時に無料クレジットが付与される（金額・条件は変更され得るため要確認）。

## 3. STT_PROVIDER と必須キーの対応

`.env` の `STT_PROVIDER` で使うSTT実装を切り替える。選んだ方式に応じて必須キーが変わる。

| STT_PROVIDER | STTで必須のキー | 返答内容判定で必須のキー |
|---|---|---|
| `deepgram`（既定） | `DEEPGRAM_API_KEY` | `GEMINI_API_KEY` |
| `gemini_live` | `GEMINI_API_KEY` | `GEMINI_API_KEY` |

- `gemini_live` を採用する場合、Deepgramキーは不要になり得る。STT方式の最終決定（README
  「未確定・要検討事項」）と合わせて進める。
- `STT_PROVIDER` に上記以外の値を入れると `src/main/env.ts` が明示的にエラーを投げる。

## 4. キーの安全な共有

- **各メンバーが自分のキーを個人発行する**のを基本とする（無料枠で足りるため）。
- リポジトリ・チャット・Issue/PRへの**平文貼り付けは禁止**。`.env` はコミットしない
  （`.gitignore` 済み）。
- どうしても共有が必要な場合は、パスワードマネージャ等のシークレット共有機能を使う。

## 5. 動作確認

```bash
npm run dev        # アプリ起動
npm test           # ユニットテスト
```

- キー未設定でも起動・ビルドは可能。返答内容判定（#13）はキー未設定時、実APIを呼ばず
  スタブ結果（中立スコア）を返す。
- キーが**必須**の処理は `src/main/env.ts` の `requireGeminiApiKey()` /
  `requireDeepgramApiKey()` を使い、未設定時に取得手順を含む分かりやすいエラーを出す。
