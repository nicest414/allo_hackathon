import { useDominanceStore } from '../store/useDominanceStore'
import { createDominanceAggregator } from './dominanceAggregator'

/**
 * アプリ全体で共有する優勢度オーケストレーターのシングルトン。
 * 各分析の producer（顔/声/フィラー/返答）が report* を呼ぶと、最新値をthrottleでまとめて
 * Store の setScores に流す。基礎優勢度・LLM補正・返答スコアのEMAなどの再計算は Store 側が担う。
 *
 * Zustand Storeはグローバルなので、React外（サービス/フック）からも getState() で更新できる。
 */
export const dominanceOrchestrator = createDominanceAggregator({
  onFlush: (update) => {
    useDominanceStore.getState().setScores(update)
  }
})
