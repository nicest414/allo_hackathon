# アーキテクチャ確認メモ

## 結論

現時点のアーキテクチャは、ハッカソンの目的である「Web会議画面に重ねて、面接中の優勢度をリアルタイム表示する」要件に対して妥当です。

主な理由は次の通りです。

- OSのウィンドウ制御、画面キャプチャ、出力音声キャプチャをElectron mainプロセスに集約している
- APIキーや外部サービス呼び出しをmain側に閉じ込め、rendererへ秘密情報を渡さない構成にしている
- preloadの`contextBridge`と共有型でIPC契約を明示し、rendererから直接Node/Electron APIへ触れない
- 顔・声・STT・LLM・スコアリング・UIをディレクトリ単位で分け、計算ロジックをReactから独立させている
- STTを`SttProvider`インターフェースで差し替え可能にしており、Deepgram/Gemini Liveの未確定リスクを吸収できる

一方で、プロダクトとして安定させるには未接続の実装やOS依存の解消が残っています。これらは構成の問題というより、実装進捗と運用対象OSの問題です。

## 要件と責務分割の対応

| 要件 | 採用している責務分割 | 妥当性 |
|---|---|---|
| 他アプリ上への透明オーバーレイ | `src/main/windows/`で`BrowserWindow`を生成 | `transparent`、`alwaysOnTop`、`setIgnoreMouseEvents`はElectron main側で扱う必要がある |
| Web会議の画面・音声取得 | `src/main/capture/`、`src/main/audio/` | desktopCapturerやloopback音声はOS/Electron API寄りのためmain側に置くのが自然 |
| APIキー保護 | `src/main/env.ts`、`src/main/llm/` | rendererはDevToolsから見えるため、秘密情報をmainに閉じる設計は必須 |
| 安全なrenderer連携 | `src/preload/`、`src/shared/types/` | `contextBridge`で公開APIを絞り、IPCの入出力型を共有できる |
| リアルタイム分析 | `src/renderer/src/analysis/`、`src/renderer/src/domain/scoring/` | ブラウザAPIやWeb Audioに近い処理と、pure TSの計算処理を分けられる |
| UI表示 | `src/renderer/src/ui/`、`src/renderer/src/store/` | Reactは描画、Zustandはローカル状態、scoringは計算に限定できる |

## 採用理由

### Electron

Electronはこのアプリの中心要件に合っています。ブラウザ単体では、Web会議アプリの上に常時表示する透明ウィンドウや、クリック透過、OSレベルの画面キャプチャ制御を十分に扱えません。ElectronならmainプロセスでOS寄りの処理を担い、rendererでReact UIを作れます。

Tauriも候補になりますが、現状の技術リスクはElectronの方が低いです。特に出力音声キャプチャは既存のElectron向けloopback実装を使える余地があり、ハッカソン期間中にRust側のOS別実装へ踏み込む必要がありません。

### main / preload / rendererの分離

mainはOS API、ウィンドウ制御、外部APIキー、STT/LLM呼び出しを持ちます。preloadはrendererへ公開する最小APIだけを`contextBridge`で渡します。rendererはUI、ブラウザAPIによる入力取得、分析、表示状態を扱います。

この分離により、rendererから秘密情報やNode APIへ直接触れずに済みます。また、IPC契約を`src/shared/types/`に寄せることで、main/preload/renderer間のデータ形状を追いやすくしています。

### STTプロバイダ差し替え

STTは日本語フィラーを残せるか、遅延が十分低いかで採用可否が変わります。現時点でDeepgramとGemini Liveを即断しないのは妥当です。

`src/main/stt/SttProvider.ts`を共通インターフェースにし、`STT_PROVIDER`環境変数で実装を選ぶ構成なら、renderer側は「transcriptが届く」という契約だけに依存できます。これは未確定要素をmain側に閉じ込めるための適切な境界です。

### LLM判定をmain側に置く

返答内容の判定は外部APIキーを使うため、rendererではなくmain側に置く判断が妥当です。rendererは質問と回答を送ってスコアと理由を受け取るだけにしておくと、キー漏えいリスクとUI側の責務肥大を抑えられます。

### scoringをpure TSにする

優勢度計算は仕様変更が起きやすい領域です。`src/renderer/src/domain/scoring/`をReact/Electron非依存のpure TSにしているため、重み付けや正規化をUIから切り離してテストできます。

現状の`DOMINANCE_WEIGHTS`は暫定値ですが、定数として外出しされており、実データに合わせて調整しやすい形です。

### Zustand

このアプリは単一端末上で動くリアルタイムオーバーレイであり、サーバー同期や複雑な非同期キャッシュは不要です。Zustandは、優勢度や内訳スコアのような小規模ローカル状態を扱うには十分で、ReduxやFirebase等を入れるより実装コストが低くなります。

## 代替案と不採用理由

| 代替案 | 不採用理由 |
|---|---|
| ブラウザWebアプリのみ | 他アプリ上への透明・常時最前面・クリック透過オーバーレイを実現できない |
| Next.js | SSR、API Routes、SEOなどの前提がElectron常駐アプリと合わず、構成が重くなる |
| Tauri | 軽量だが、loopback音声やOS別の画面制御でRust実装の負担が増える |
| rendererから直接API呼び出し | APIキーがDevTools等から露出しやすく、秘密情報管理として不適切 |
| STTを1社に固定 | 日本語フィラー保持と低遅延の実測前に固定すると、後戻りコストが大きい |
| scoringをUIコンポーネント内に実装 | 仕様変更時にUIと計算が絡み、テストしにくくなる |

## 現時点の注意点

- `registerLlmIpc()`は実装済みだが、main entryへの登録は別途確認・接続が必要
- overlayクリック透過の切り替えAPIはwindow helper側に実装があるため、IPC公開との整合確認が必要
- `electron-audio-loopback`相当のloopback音声取得はmacOS依存が強く、Windows対応時はWASAPI loopback等の別経路が必要
- MediaPipeや音声特徴量はそのまま「焦り度」にならないため、スコアリング式は実データで調整する必要がある
- STTはDeepgram/Gemini Liveのフィラー保持率、遅延、コストを実測して一本化する必要がある

## 今後の判断基準

1. STTの最終決定は、日本語フィラー保持率、確定文字列までの遅延、APIコストで比較する
2. スコアリング重みは、録画または擬似データで期待値に近い優勢度が出るかをテストして調整する
3. Windows対応を行う場合は、音声loopbackと透明オーバーレイのOS別実装をmain層に閉じ込める
4. rendererに秘密情報やNode APIが流れないことを、preload公開APIとshared typesのレビューで確認する
5. UI変更時も、`domain/scoring/`のpure関数テストが壊れない範囲で責務分離を維持する

## 確認結果

この構成は、現時点の要件に対して過剰でも不足でもありません。Electronを採用してOS寄りの処理をmainに寄せ、rendererをUIとブラウザAPI中心に保ち、未確定のSTTやスコアリングを差し替え可能な境界に置いている点が適切です。

今後は、未接続のIPC登録、STT一本化、OS依存の整理を進めることで、現在のアーキテクチャを保ったまま実装を固められます。
