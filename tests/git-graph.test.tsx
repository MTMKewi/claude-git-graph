import { expect, test } from 'claude-code/testing'

import type { Commit } from '../types'
import { graphSvg, graphText, layout, LOG_FORMAT, parseLog, svgWidth } from '../hooks/graph'

const commit = (hash: string, parents: string[] = []): Commit => ({
  hash,
  parents,
  refs: [],
  shortHash: hash,
  author: 'a',
  date: 'd',
  subject: `konu ${hash}`,
})

// Aynı dal iki kez main'e birleşmiş bir geçmiş.
const HISTORY = [
  commit('m2', ['m1', 'f4']),
  commit('f4', ['f3']),
  commit('f3', ['f2']),
  commit('f2', ['f1']),
  commit('m1', ['root', 'f1']),
  commit('f1', ['root']),
  commit('root'),
]

test('iki kez birleşen dal doğru şeritlere yerleşir', () => {
  const rows = layout(HISTORY)
  expect(rows.map(row => row.lane)).toEqual([0, 1, 1, 1, 0, 1, 0])
  // m1, f1'e sağa doğru dallanır.
  expect(rows[4]?.segments).toContainEqual({ from: 0, to: 1, color: 1 })
  // f1'den çıkan çizgi kökte birleşince şerit 0'a bağlanır.
  expect(rows[5]?.segments).toContainEqual({ from: 1, to: 0, color: 1 })
  expect(rows[6]?.segments).toEqual([])
})

test('git çıktısı ref türleriyle ayrıştırılır', () => {
  const line = ['aaa', 'bbb ccc', 'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1, refs/heads/feature/x', 'aa', 'Yazar', '2 gün önce', 'Şirin <konu> & test'].join('\x1f')
  const [parsed] = parseLog(`${line}\n`)
  expect(parsed?.parents).toEqual(['bbb', 'ccc'])
  expect(parsed?.refs).toEqual([
    { name: 'main', kind: 'head' },
    { name: 'origin/main', kind: 'remote' },
    { name: 'v1', kind: 'tag' },
    { name: 'feature/x', kind: 'branch' },
  ])
  const { source } = graphSvg(layout(parsed ? [parsed] : []), 600)
  expect(source).toContain('&lt;konu&gt; &amp; test')
  expect(LOG_FORMAT).toContain('%x1f')
})

test('SVG kaynak sınırını aşmaz', () => {
  const many = Array.from({ length: 2000 }, (_, i) => commit(`c${i}`, i < 1999 ? [`c${i + 1}`] : []))
  const { source, drawn } = graphSvg(layout(many), 600)
  expect(source.length).toBeLessThan(131_072)
  expect(drawn).toBeLessThan(2000)
})

test('git --graph çıktısından hem commitler hem metin grafik çıkar', () => {
  const record = (hash: string, parents: string, refs: string, subject: string) =>
    [hash, parents, refs, hash.slice(0, 3), 'Yazar', 'dün', subject].join('\x1f')
  const stdout = [
    `*   ${record('aaa111', 'bbb222 ccc333', 'HEAD -> refs/heads/main', 'Birleştirme')}`,
    '|\\  ',
    `| * ${record('ccc333', 'bbb222', 'refs/remotes/origin/dal', 'Dal işi')}`,
    '|/  ',
    `* ${record('bbb222', '', '', 'İlk commit')}`,
    '',
  ].join('\n')

  expect(parseLog(stdout).map(one => one.hash)).toEqual(['aaa111', 'ccc333', 'bbb222'])
  expect(graphText(stdout)).toBe(
    [
      '*   aaa [main] Birleştirme · dün',
      '|\\',
      '| * ccc [origin/dal] Dal işi · dün',
      '|/',
      '* bbb İlk commit · dün',
    ].join('\n'),
  )
})

test('yakınlaştırma çizimi büyütür, genişlik panele göre belirlenir', () => {
  const rows = layout(HISTORY)
  const normal = graphSvg(rows, 420, 1).source
  const zoomed = graphSvg(rows, 420, 2).source
  expect(svgWidth(52)).toBe(416)
  expect(svgWidth(200)).toBe(1000)
  expect(graphSvg(rows, 420, 2).height).toBe(588)
  expect(normal).toContain('viewBox="0 0 420 294"')
  expect(normal).toContain('height="294"')
  expect(zoomed).toContain('viewBox="0 0 210 294"')
  expect(zoomed).toContain('height="588"')
})

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'git-graph',
  props: {
    title: 'Git Grafiği',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const LOG = ['abc', '', 'HEAD -> refs/heads/main', 'ab', 'Yazar', 'dün', 'İlk commit'].join('\x1f')

test('panel her yüzeyde grafiği çizer, hatalı depoda hatayı söyler', async ($, on) => {
  let exitCode = 0
  on('command.register', () => ({ value: { command: 'git-graph' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value:
      exitCode === 0
        ? { exitCode, stdout: `${LOG}\n`, stderr: '' }
        : { exitCode, stdout: '', stderr: 'fatal: bir git deposu değil\n' },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'git-graph' })

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Code' })).toBeDefined()
  expect(await desktop.find({ type: 'Svg' })).toBeUndefined()
  expect(await desktop.find({ key: 'fetch' })).toBeDefined()
  expect(await desktop.find({ key: 'zoom-in' })).toBeUndefined()
  await desktop.press({ key: 'mode' })
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  expect(await desktop.find({ key: 'zoom-in' })).toBeDefined()
  await desktop.press({ key: 'zoom-in' })
  expect(await desktop.find({ type: 'Text', text: /%150/ })).toBeDefined()
  // Boyut verilmeyen Svg, masaüstünde 150 piksellik varsayılan kutuya sığdırılıyordu.
  const drawn = JSON.stringify(await desktop.drawn())
  expect(drawn).toContain('"width":480')
  expect(drawn).toContain('"height":63')
  await desktop.press({ key: 'mode' })
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Code' })).toBeDefined()
  await terminal.unmount()

  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await mobile.find({ type: 'Svg' })).toBeDefined()
  await mobile.unmount()

  exitCode = 128
  const failed = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await failed.press({ key: 'refresh' })
  expect((await failed.find({ type: 'Text', text: /Hata/ }))?.text).toContain('git deposu değil')
  await failed.unmount()
})
