import type { Commit, Ref } from '../types'

const FIELD = '\x1f'

// `git log --decorate=full` ile okunur: %D tam ref adlarını verir, böylece
// `feature/x` gibi yerel bir dal `origin/x` gibi uzak bir daldan ayrılır.
export const LOG_FORMAT = ['%H', '%P', '%D', '%h', '%an', '%ar', '%s'].join('%x1f')

function parseRef(raw: string): Ref | undefined {
  if (raw === 'HEAD') return { name: 'HEAD', kind: 'head' }
  if (raw.startsWith('HEAD -> ')) {
    return { name: raw.slice('HEAD -> refs/heads/'.length), kind: 'head' }
  }
  if (raw.startsWith('tag: ')) {
    return { name: raw.slice('tag: refs/tags/'.length), kind: 'tag' }
  }
  if (raw.startsWith('refs/heads/')) {
    return { name: raw.slice('refs/heads/'.length), kind: 'branch' }
  }
  if (raw.startsWith('refs/remotes/')) {
    // origin/HEAD yalnızca varsayılan dalı işaret eder, grafikte gürültüdür.
    if (raw.endsWith('/HEAD')) return undefined
    return { name: raw.slice('refs/remotes/'.length), kind: 'remote' }
  }
  return undefined
}

// `git log --graph` her satırın başına grafik karakterlerini koyar.
const GRAPH_PREFIX = /^[*|\\/ _.-]*/

function parseCommit(record: string): Commit {
  const [hash = '', parents = '', refs = '', shortHash = '', author = '', date = '', ...subject] =
    record.split(FIELD)

  return {
    hash,
    parents: parents.split(' ').filter(Boolean),
    refs: refs
      .split(', ')
      .map(parseRef)
      .filter((ref): ref is Ref => ref !== undefined),
    shortHash,
    author,
    date,
    subject: subject.join(FIELD),
  }
}

function graphPrefix(line: string): string {
  return GRAPH_PREFIX.exec(line)?.[0] ?? ''
}

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split('\n')
    .filter(line => line.includes(FIELD))
    .map(line => parseCommit(line.slice(graphPrefix(line).length)))
}

/** `git log --graph` çıktısını okunur metin grafiğe çevirir. */
export function graphText(stdout: string): string {
  return stdout
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      if (!line.includes(FIELD)) return line.trimEnd()
      const prefix = graphPrefix(line)
      const commit = parseCommit(line.slice(prefix.length))
      const refs = commit.refs.map(ref => `[${ref.name}]`).join(' ')

      return `${prefix}${commit.shortHash} ${refs ? `${refs} ` : ''}${commit.subject} · ${commit.date}`
    })
    .join('\n')
}

export type Segment = { from: number; to: number; color: number }
export type Row = { commit: Commit; lane: number; segments: Segment[] }

/**
 * Commit'leri şeritlere yerleştirir. Her satırın `segments` listesi o satırdan
 * bir alttakine giden çizgilerdir. Girdi çocuktan ebeveyne sıralı olmalıdır
 * (`--topo-order`).
 */
export function layout(commits: readonly Commit[]): Row[] {
  const lanes: (string | null)[] = []
  const rows: Row[] = []
  const freeLane = () => {
    const free = lanes.indexOf(null)

    return free < 0 ? lanes.length : free
  }

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = freeLane()
      lanes[lane] = commit.hash
    }

    // Bu commit'i bekleyen diğer şeritler burada birleşir: bir üst satırdan
    // gelen çizgileri bu commit'in şeridine bağla ve şeridi boşalt.
    lanes.forEach((waiting, index) => {
      if (waiting !== commit.hash || index === lane) return
      lanes[index] = null
      for (const segment of rows.at(-1)?.segments ?? []) {
        if (segment.to === index) segment.to = lane
      }
    })

    const segments: Segment[] = []
    lanes.forEach((waiting, index) => {
      if (waiting !== null && index !== lane) {
        segments.push({ from: index, to: index, color: index })
      }
    })

    const [first, ...others] = commit.parents
    lanes[lane] = first ?? null
    if (first !== undefined) segments.push({ from: lane, to: lane, color: lane })
    for (const parent of others) {
      let target = lanes.indexOf(parent)
      if (target < 0) {
        target = freeLane()
        lanes[target] = parent
      }
      segments.push({ from: lane, to: target, color: target })
    }

    rows.push({ commit, lane, segments })
  }

  return rows
}

function laneCount(rows: readonly Row[]): number {
  let most = 0
  for (const row of rows) {
    most = Math.max(most, row.lane)
    for (const segment of row.segments) most = Math.max(most, segment.from, segment.to)
  }

  return most + 1
}

const ROW_HEIGHT = 42
const LANE_WIDTH = 16
const PADDING = 14
const CHAR_WIDTH = 7.2
const SMALL_CHAR_WIDTH = 6.4
// Svg öğesinin kaynak sınırı 131072 karakterdir; pay bırakılır.
const SOURCE_BUDGET = 125_000

// Panelin kendi koyu zemini vardır, bu yüzden renkler uygulama temasından
// bağımsız olarak okunaklı kalır.
const BACKGROUND = '#1b1f24'
const TEXT = '#e6e8eb'
const MUTED = '#9aa4af'
const PALETTE = ['#58a6ff', '#3fb950', '#f778ba', '#d29922', '#a371f7', '#39c5cf', '#ff7b72', '#8ddb8c']
const CHIP: Record<Ref['kind'], { fill: string; text: string }> = {
  head: { fill: '#238636', text: '#ffffff' },
  branch: { fill: '#1f6feb', text: '#ffffff' },
  remote: { fill: '#30363d', text: '#c9d1d9' },
  tag: { fill: '#9e6a03', text: '#ffffff' },
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cut(text: string, room: number): string {
  if (room <= 1) return ''

  return text.length <= room ? text : `${text.slice(0, room - 1)}…`
}

function color(index: number): string {
  return PALETTE[index % PALETTE.length] ?? MUTED
}

function drawRow(row: Row, y: number, textX: number, width: number): string {
  const centerY = y * ROW_HEIGHT + ROW_HEIGHT / 2
  const laneX = (lane: number) => PADDING + lane * LANE_WIDTH
  const lines = row.segments
    .map(segment => {
      const fromX = laneX(segment.from)
      const toX = laneX(segment.to)
      const endY = centerY + ROW_HEIGHT
      const path =
        fromX === toX
          ? `M${fromX} ${centerY}V${endY}`
          : `M${fromX} ${centerY}C${fromX} ${centerY + ROW_HEIGHT * 0.6} ${toX} ${endY - ROW_HEIGHT * 0.6} ${toX} ${endY}`

      return `<path d="${path}" stroke="${color(segment.color)}"/>`
    })
    .join('')

  const { commit, lane } = row
  const isMerge = commit.parents.length > 1
  const dot = isMerge
    ? `<circle cx="${laneX(lane)}" cy="${centerY}" r="5" fill="${BACKGROUND}" stroke="${color(lane)}"/>`
    : `<circle cx="${laneX(lane)}" cy="${centerY}" r="5" fill="${color(lane)}" stroke="none"/>`

  let x = textX
  let chips = ''
  const room = width - PADDING
  for (const ref of commit.refs) {
    const label = cut(ref.name, 24)
    const chipWidth = label.length * SMALL_CHAR_WIDTH + 10
    if (x + chipWidth > room) break
    const style = CHIP[ref.kind]
    chips += `<rect x="${x}" y="${centerY - 16}" width="${chipWidth}" height="15" rx="3" fill="${style.fill}" stroke="none"/><text x="${x + 5}" y="${centerY - 5}" font-size="11" fill="${style.text}" stroke="none">${escapeXml(label)}</text>`
    x += chipWidth + 4
  }

  const subject = cut(commit.subject, Math.floor((room - x) / CHAR_WIDTH))
  const details = cut(
    `${commit.shortHash} · ${commit.author} · ${commit.date}`,
    Math.floor((room - textX) / SMALL_CHAR_WIDTH),
  )
  const tooltip = `${commit.shortHash} · ${commit.author} · ${commit.date}\n${commit.subject}`

  return (
    `<g>${lines}${dot}${chips}` +
    `<text x="${x}" y="${centerY - 4}" font-size="12" fill="${TEXT}" stroke="none">${escapeXml(subject)}</text>` +
    `<text x="${textX}" y="${centerY + 13}" font-size="11" fill="${MUTED}" stroke="none">${escapeXml(details)}</text>` +
    `<title>${escapeXml(tooltip)}</title></g>`
  )
}

/** SVG'nin piksel genişliği: panelin sütun sayısından, bir sütun 8 piksel sayılır. */
export function svgWidth(columns: number): number {
  return Math.min(1000, Math.max(280, Math.round(columns * 8)))
}

export function graphSvg(
  rows: readonly Row[],
  width: number,
  zoom = 1,
): { source: string; drawn: number; width: number; height: number } {
  // Yakınlaştırma, aynı piksel genişliğine daha az mantıksal alan sığdırır.
  const logicalWidth = Math.round(width / zoom)
  const textX = PADDING + laneCount(rows) * LANE_WIDTH + 2
  const parts: string[] = []
  let size = 0
  for (const [y, row] of rows.entries()) {
    const part = drawRow(row, y, textX, logicalWidth)
    if (size + part.length > SOURCE_BUDGET) break
    parts.push(part)
    size += part.length
  }
  const height = parts.length * ROW_HEIGHT
  const pixelHeight = Math.round(height * zoom)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${pixelHeight}" viewBox="0 0 ${logicalWidth} ${height}" ` +
    `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" fill="none" stroke-width="2">` +
    `<rect width="${logicalWidth}" height="${height}" rx="6" fill="${BACKGROUND}"/>${parts.join('')}</svg>`

  return { source, drawn: parts.length, width, height: pixelHeight }
}
