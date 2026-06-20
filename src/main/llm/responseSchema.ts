/**
 * Gemini Flashの構造化出力（responseSchema）定義。
 *
 * 自然文をそのままパースすると不安定なため、`responseMimeType: application/json`
 * と合わせてこのスキーマを渡し、優勢度計算ロジックにそのまま渡せる形で受け取る。
 * 返り値は `LlmJudgeResponseResult`（= ResponseJudgment の score/reason）に対応する。
 */
export const RESPONSE_JUDGMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: {
      type: 'INTEGER',
      description: '質問への返答内容の良さを表す0〜100の整数。高いほど良い返答。',
      minimum: 0,
      maximum: 100
    },
    reason: {
      type: 'STRING',
      description: 'スコアの根拠を日本語で簡潔に説明する。'
    }
  },
  required: ['score', 'reason'],
  // 出力順を固定し、パース・デバッグを安定させる
  propertyOrdering: ['score', 'reason']
} as const
