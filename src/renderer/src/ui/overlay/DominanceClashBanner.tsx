import type { CSSProperties, ReactElement } from 'react'
import './DominanceClashBanner.css'
import leftPortrait from '../../assets/portrait/left.png'
import rightPortrait from '../../assets/portrait/right.png'
import lightningVideo from '../../assets/video/lightning_transparent.webm'

interface DominanceClashBannerProps {
  value: number
  candidatePortraitSrc?: string
  interviewerPortraitSrc?: string
}

interface ClashBannerStyle extends CSSProperties {
  '--left-width': string
  '--right-width': string
  '--dominance-intensity': string
}

const VIEW_WIDTH = 100
const VIEW_HEIGHT = 40
const BOLT_COUNT_PER_SIDE = 4

/** シード値から[0,1)の決定論的な擬似乱数を作る。再描画ごとに形が変わらないようにするため。 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}

interface BoltConfig {
  side: 'left' | 'right'
  index: number
}

/**
 * 中央(衝突点)に近づくほど頂点が密集し、外側ほど粗くなるジグザグpathを生成する。
 * 密度はeasingカーブ(t^power)で作り、leftとrightでpower/振幅/フェーズをずらすことで
 * 単純な左右対称(ミラー)ではない煽り画像らしい非対称さを出す。
 */
function buildBoltPath({ side, index }: BoltConfig): string {
  const steps = 14 + index * 2
  const densityPower = side === 'left' ? 2.3 + index * 0.3 : 2.8 + index * 0.25
  const baseAmplitude = side === 'left' ? 6.5 - index * 0.6 : 5.6 - index * 0.45
  const baseY = 4 + index * 10.5
  const seed = side === 'left' ? 11 + index * 37 : 53 + index * 41

  const points: string[] = []
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    // 中央側ほどtの変化に対するxの変化が小さくなり、頂点が密集する
    const eased = side === 'left' ? 1 - (1 - t) ** densityPower : t ** densityPower
    const x = eased * VIEW_WIDTH
    const centerProximity = side === 'left' ? eased : 1 - eased
    const amplitude = baseAmplitude * (0.4 + centerProximity * 1.2)
    const jitter = seededRandom(seed + step * 12.9898) - 0.5
    const direction = step % 2 === 0 ? 1 : -1
    const y = baseY + direction * amplitude + jitter * amplitude * 0.9
    const clampedY = Math.min(VIEW_HEIGHT - 2, Math.max(2, y))
    points.push(`${step === 0 ? 'M' : 'L'}${x.toFixed(1)},${clampedY.toFixed(1)}`)
  }
  return points.join(' ')
}

const BOLT_INDICES = Array.from({ length: BOLT_COUNT_PER_SIDE }, (_, index) => index)
const LEFT_BOLTS = BOLT_INDICES.map((index) => buildBoltPath({ side: 'left', index }))
const RIGHT_BOLTS = BOLT_INDICES.map((index) => buildBoltPath({ side: 'right', index }))

function BoltGroup({ paths }: { paths: string[] }): ReactElement {
  return (
    <svg className="clash-banner__bolts" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d, index) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth={2.4 - index * 0.35}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

/**
 * 優勢/劣勢を、両陣営の雷が中央でせめぎ合うバナー演出として表示する。
 * 各ゾーンの幅は優勢度に応じて変わり、優勢な側が画面のより広い面積を占有する。
 */
export function DominanceClashBanner({
  value,
  candidatePortraitSrc,
  interviewerPortraitSrc
}: DominanceClashBannerProps): ReactElement {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  // value(優勢度)は100=候補者(You/左)が完全優勢、0=面接官(相手/右)が完全優勢
  // (dominanceCalculatorのテスト参照)。Youは左側なので、優勢度が高いほど左ゾーンを広げる。
  const leftWidth = clamped
  const rightWidth = 100 - clamped
  // 互角(50)から離れるほど一方的な展開とみなし、中央の衝突エフェクトを強くする
  const dominanceIntensity = Math.abs(clamped - 50) / 50
  const leadingSide = clamped === 50 ? null : clamped > 50 ? 'left' : 'right'
  // 境界線の位置は --left-width/--right-width で渡し、実際の表示位置は
  // CSS側で僅かなにじり(--clash-jitter)を加えて計算する。数値表示(clamped)はにじりの影響を受けない。
  const boundaryVars: ClashBannerStyle = {
    '--left-width': `${leftWidth}%`,
    '--right-width': `${rightWidth}%`,
    '--dominance-intensity': dominanceIntensity.toFixed(2)
  }
  const leftPortraitSrc = candidatePortraitSrc ?? leftPortrait
  const rightPortraitSrc = interviewerPortraitSrc ?? rightPortrait
  const isLeftPortraitCaptured = candidatePortraitSrc !== undefined
  const isRightPortraitCaptured = interviewerPortraitSrc !== undefined

  return (
    <div
      className={`clash-banner${leadingSide ? ` clash-banner--leading-${leadingSide}` : ''}`}
      role="img"
      aria-label={`優勢度 ${clamped}`}
      style={boundaryVars}
    >
      <div className="clash-banner__zone clash-banner__zone--left">
        <div className="clash-banner__rays" aria-hidden="true" />
        <BoltGroup paths={LEFT_BOLTS} />
        <div className="clash-banner__sweep" />
      </div>
      <div className="clash-banner__zone clash-banner__zone--right">
        <div className="clash-banner__rays" aria-hidden="true" />
        <BoltGroup paths={RIGHT_BOLTS} />
        <div className="clash-banner__sweep" />
      </div>
      <div className="clash-banner__portrait-mask clash-banner__portrait-mask--left">
        <img
          className={`clash-banner__portrait clash-banner__portrait--left${
            isLeftPortraitCaptured ? ' clash-banner__portrait--captured' : ''
          }`}
          src={leftPortraitSrc}
          alt=""
          aria-hidden="true"
        />
      </div>
      <div className="clash-banner__portrait-mask clash-banner__portrait-mask--right">
        <img
          className={`clash-banner__portrait clash-banner__portrait--right${
            isRightPortraitCaptured ? ' clash-banner__portrait--captured' : ''
          }`}
          src={rightPortraitSrc}
          alt=""
          aria-hidden="true"
        />
      </div>
      <div className="clash-banner__clash">
        <div className="clash-banner__lightning-mask">
          <video
            className="clash-banner__lightning"
            src={lightningVideo}
            autoPlay
            loop
            muted
            playsInline
            disablePictureInPicture
            aria-hidden="true"
          />
        </div>
      </div>
      <span className="clash-banner__label clash-banner__label--left">You</span>
      <span className="clash-banner__label clash-banner__label--right">相手</span>
    </div>
  )
}
