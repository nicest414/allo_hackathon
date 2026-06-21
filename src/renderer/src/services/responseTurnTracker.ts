import type { LlmJudgeResponseRequest } from '../../../shared/types/ipc'

/**
 * 面接官の質問と就活生の回答を「ターン」として管理し、
 * 質問と回答のやり取りが1セット終わるタイミングで自動判定を発火する
 * pure TS ロジック（Reactに非依存・テスト可能）。
 *
 * - setQuestion(): 面接官の発話を受け取る。
 *   - 相槌（「はい」「聞こえております」等）は無視し、蓄積中の回答を消さない。
 *   - まだ回答が始まっていない（answerSegments空）状態で questionMergeGapMs 以内に届いた発話は、
 *     STTの確定区切りで1つの質問が複数finalに分裂しただけとみなし、既存の質問に連結する
 *     （置き換えると分裂後半だけが残ってしまうため）。
 *   - 回答が始まった後に届く発話、または間隔が空いた発話は「本物の新しい質問」＝「前ターンの終了」とみなし、
 *     蓄積済みの回答をその場で確定発火してから次のターンに切り替える。
 * - addAnswer():  回答セグメントを蓄積し、フォールバック沈黙タイマーを張り直す。
 * - フォールバック沈黙(silenceMs)継続で maybeEmit() → 次の質問が来ないまま終わった最終ターンなどを救う安全網。
 *
 * トークン浪費を防ぐため、空入力・極短回答(minAnswerLength未満)は発火しない。
 * 同一ペアの重複判定防止(dedup)は呼び出し先の responseJudger 側で担う。
 */

export interface ResponseTurnTrackerOptions {
  /** 判定発火のコールバック。 */
  onTurn: (request: LlmJudgeResponseRequest) => void
  /** 次の質問が来ないまま終わった場合の安全網。最後の回答セグメントからこの時間(ms)沈黙したら発火。既定8000。 */
  silenceMs?: number
  /** これ未満の文字数の回答は発火しない（「はい」等の無駄打ち防止）。既定4。 */
  minAnswerLength?: number
  /**
   * 回答未着手の状態でこの間隔(ms)以内に届いた質問発話は、STTの確定区切りで
   * 1つの質問が分裂しただけとみなして連結する。既定3000。
   */
  questionMergeGapMs?: number
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  /** 面接官の発話が相槌（ターン境界にしない発話）かどうかの判定関数。既定は組み込みの定型句リスト。 */
  isBackchannel?: (text: string) => boolean
}

export interface ResponseTurnTracker {
  setQuestion: (text: string) => void
  addAnswer: (text: string) => void
  reset: () => void
  dispose: () => void
}

const DEFAULT_SILENCE_MS = 8000
const DEFAULT_MIN_ANSWER_LENGTH = 4
const DEFAULT_QUESTION_MERGE_GAP_MS = 3000

/**
 * 面接官の相槌・つなぎ言葉の定型句。
 * 完全一致のみ判定対象とする（前方一致だと「はい。〜」のような実質的な質問/指示まで
 * 誤って相槌扱いしてしまうため）。
 */
const BACKCHANNEL_PHRASES = new Set([
  'はい',
  'はーい',
  'はいはい',
  'うん',
  'うんうん',
  'ええ',
  'えー',
  'そうですか',
  'そうですね',
  'そうなんですね',
  'なるほど',
  'なるほどですね',
  '了解',
  '了解です',
  'わかりました',
  '承知しました',
  '承知いたしました',
  '聞こえております',
  '聞こえています',
  '聞こえてます',
  '聞こえます',
  'ありがとうございます',
  'ありがとうございました'
])

export function isBackchannelUtterance(text: string): boolean {
  const normalized = text.trim().replace(/[。！？\s]+$/g, '')
  return BACKCHANNEL_PHRASES.has(normalized)
}

export function createResponseTurnTracker(
  options: ResponseTurnTrackerOptions
): ResponseTurnTracker {
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS
  const minAnswerLength = options.minAnswerLength ?? DEFAULT_MIN_ANSWER_LENGTH
  const questionMergeGapMs = options.questionMergeGapMs ?? DEFAULT_QUESTION_MERGE_GAP_MS
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
  const isBackchannel = options.isBackchannel ?? isBackchannelUtterance
  const now = options.now ?? (() => Date.now())

  let question = ''
  let answerSegments: string[] = []
  let lastQuestionFragmentAt = 0
  let silenceTimer: ReturnType<typeof setTimeout> | undefined

  function clearSilenceTimer(): void {
    if (silenceTimer !== undefined) {
      clearTimer(silenceTimer)
      silenceTimer = undefined
    }
  }

  /** 蓄積中の質問×回答が条件を満たせば確定発火する。共通ガード（質問なし/極短回答）を内包。 */
  function tryEmitPendingTurn(): void {
    const answer = answerSegments.join(' ').trim()

    if (question.trim() === '' || answer.length < minAnswerLength) {
      return
    }

    options.onTurn({ question, answer })
  }

  function maybeEmit(): void {
    silenceTimer = undefined
    tryEmitPendingTurn()
  }

  return {
    setQuestion(text: string): void {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }

      // 相槌はターン境界にしない。蓄積中の回答を消さずに無視する。
      if (isBackchannel(trimmed)) {
        return
      }

      const timestamp = now()
      const isFragmentOfSameQuestion =
        question.trim() !== '' &&
        answerSegments.length === 0 &&
        timestamp - lastQuestionFragmentAt <= questionMergeGapMs

      if (isFragmentOfSameQuestion) {
        // 回答未着手のまま短時間で届いた発話＝STTの確定区切りで同じ質問が分裂しただけ。
        // 置き換えると分裂後半だけが残ってしまうため連結する。
        question = `${question} ${trimmed}`
        lastQuestionFragmentAt = timestamp
        clearSilenceTimer()
        return
      }

      // 本物の新しい質問＝前ターンの終了タイミング。切り替え前に確定発火する。
      tryEmitPendingTurn()

      question = trimmed
      answerSegments = []
      lastQuestionFragmentAt = timestamp
      clearSilenceTimer()
    },

    addAnswer(text: string): void {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }
      answerSegments.push(trimmed)
      clearSilenceTimer()
      silenceTimer = setTimer(maybeEmit, silenceMs)
    },

    reset(): void {
      clearSilenceTimer()
      question = ''
      answerSegments = []
      lastQuestionFragmentAt = 0
    },

    dispose(): void {
      clearSilenceTimer()
    }
  }
}
