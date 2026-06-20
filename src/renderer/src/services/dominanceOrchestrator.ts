import { useDominanceStore } from '../store/useDominanceStore'
import { createDominanceAggregator } from './dominanceAggregator'

/**
 * アプリ全体で共有する優勢度オーケストレーターのシングルトン。
 * 各分析の producer（顔/声/フィラー/返答）が report* を呼ぶと、最新値を集約して
 * 優勢度を再計算し、Zustand Store（基礎優勢度・補正後優勢度・breakdown）へ反映する。
 *
 * Zustand Storeはグローバルなので、React外（サービス/フック）からも getState() で更新できる。
 */
export const dominanceOrchestrator = createDominanceAggregator({
  onChange: (result) => {
    const state = useDominanceStore.getState()
    state.setBaseDominance(result.baseDominance)
    state.setDominance(result.dominance)
    state.setScores(result.breakdown)
  }
})
