import type { ReactElement } from 'react'
import './DominanceClashBanner.css'
import leftPortrait from '../../assets/portrait/left.png'
import rightPortrait from '../../assets/portrait/right.png'

interface DominanceClashBannerProps {
  value: number
}

const LEFT_BOLTS = [
  'M0,8 L14,18 L9,23 L26,11 L21,29 L42,16 L37,33 L58,19 L53,36 L74,21 L69,38 L92,17 L100,10',
  'M0,20 L11,28 L18,16 L30,30 L26,38 L48,24 L44,12 L63,28 L59,36 L80,22 L77,33 L100,24',
  'M0,32 L16,26 L10,38 L33,20 L28,36 L50,30 L46,18 L66,34 L62,22 L86,30 L82,38 L100,30'
]

const RIGHT_BOLTS = [
  'M100,8 L86,18 L91,23 L74,11 L79,29 L58,16 L63,33 L42,19 L47,36 L26,21 L31,38 L8,17 L0,10',
  'M100,20 L89,28 L82,16 L70,30 L74,38 L52,24 L56,12 L37,28 L41,36 L20,22 L23,33 L0,24',
  'M100,32 L84,26 L90,38 L67,20 L72,36 L50,30 L54,18 L34,34 L38,22 L14,30 L18,38 L0,30'
]

function BoltGroup({ paths }: { paths: string[] }): ReactElement {
  return (
    <svg className="clash-banner__bolts" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d) => (
        <path key={d} d={d} fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

/**
 * 優勢/劣勢を、両陣営の雷が中央でせめぎ合うバナー演出として表示する。
 * 各ゾーンの幅は優勢度に応じて変わり、優勢な側が画面のより広い面積を占有する。
 */
export function DominanceClashBanner({ value }: DominanceClashBannerProps): ReactElement {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  const leftWidth = 100 - clamped
  const rightWidth = clamped

  return (
    <div className="clash-banner" role="img" aria-label={`優勢度 ${clamped}`}>
      <div className="clash-banner__zone clash-banner__zone--left" style={{ width: `${leftWidth}%` }}>
        <BoltGroup paths={LEFT_BOLTS} />
        <div className="clash-banner__sweep" />
      </div>
      <div className="clash-banner__zone clash-banner__zone--right" style={{ width: `${rightWidth}%` }}>
        <BoltGroup paths={RIGHT_BOLTS} />
        <div className="clash-banner__sweep" />
      </div>
      <img
        className="clash-banner__portrait clash-banner__portrait--left"
        src={leftPortrait}
        alt=""
        aria-hidden="true"
        style={{ right: `${rightWidth}%` }}
      />
      <img
        className="clash-banner__portrait clash-banner__portrait--right"
        src={rightPortrait}
        alt=""
        aria-hidden="true"
        style={{ left: `${leftWidth}%` }}
      />
      <div className="clash-banner__clash" style={{ left: `${leftWidth}%` }}>
        <div className="clash-banner__flash" />
        <div className="clash-banner__beam" />
        <div className="clash-banner__value">{clamped}</div>
      </div>
      <span className="clash-banner__label clash-banner__label--left">劣勢</span>
      <span className="clash-banner__label clash-banner__label--right">優勢</span>
    </div>
  )
}
