import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { graphSvg, graphText, layout, LOG_FORMAT, parseLog, svgWidth } from './graph'

const PANE = 'git-graph'
const TITLE = 'Git Grafiği'
const MAX_COMMITS = 150
const MAX_RECENT = 8
const REFRESH_MS = 15_000
const ZOOMS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const DEFAULT_ZOOM = 1.25

const view = atom(
  { plugin: 'git-graph', key: 'view' } as const,
  {
    repo: '',
    recent: [],
    commits: [],
    graphText: '',
    error: undefined,
    isBusy: false,
    zoom: DEFAULT_ZOOM,
    mode: 'text',
  } as View,
  { shape: 'view-3' },
)

async function toggleMode($: EngineInterface): Promise<void> {
  const next = await update($, view, value => ({
    ...value,
    mode: value.mode === 'text' ? ('svg' as const) : ('text' as const),
  }))
  await $.store.set('mode', next.mode)
}

async function stepZoom($: EngineInterface, direction: 1 | -1): Promise<void> {
  const next = await update($, view, value => {
    const index = ZOOMS.indexOf(value.zoom)
    const zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + direction))] ?? DEFAULT_ZOOM

    return { ...value, zoom }
  })
  await $.store.set('zoom-level', next.zoom)
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

/** Depoyu okur; çıktı değişmediyse panel boşuna yeniden çizilmez. */
async function load($: EngineInterface, repo: string): Promise<void> {
  const { exitCode, stdout, stderr } = await $.process.run([
    'git',
    '-C',
    repo,
    'log',
    '--all',
    '--graph',
    '--topo-order',
    '--decorate=full',
    `--max-count=${MAX_COMMITS}`,
    `--format=${LOG_FORMAT}`,
  ])
  const commits = exitCode === 0 ? parseLog(stdout) : []
  const text = exitCode === 0 ? graphText(stdout) : ''
  const error = exitCode === 0 ? undefined : firstLine(stderr)
  const current = await read($, view)
  if (
    current.repo === repo &&
    current.error === error &&
    current.graphText === text &&
    JSON.stringify(current.commits) === JSON.stringify(commits)
  ) {
    return
  }
  await update($, view, value =>
    value.repo === repo ? { ...value, commits, graphText: text, error } : value,
  )
}

/** Girilen yolu git kök dizinine çevirip seçili depo yapar. */
async function selectRepo($: EngineInterface, path: string): Promise<void> {
  const { exitCode, stdout, stderr } = await $.process.run([
    'git',
    '-C',
    path,
    'rev-parse',
    '--show-toplevel',
  ])
  if (exitCode !== 0) {
    await update($, view, value => ({ ...value, error: `${path}: ${firstLine(stderr)}` }))
    return
  }
  const repo = stdout.trim()
  const next = await update($, view, value => ({
    ...value,
    repo,
    recent: [repo, ...value.recent.filter(one => one !== repo)].slice(0, MAX_RECENT),
    commits: value.repo === repo ? value.commits : [],
    graphText: value.repo === repo ? value.graphText : '',
    error: undefined,
  }))
  await $.store.set('repo', next.repo)
  await $.store.set('recent', next.recent)
  await load($, repo)
}

async function fetchRemotes($: EngineInterface): Promise<void> {
  const { repo } = await read($, view)
  await update($, view, value => ({ ...value, isBusy: true }))
  try {
    const { exitCode, stderr } = await $.process.run(['git', '-C', repo, 'fetch', '--all'], {
      timeoutMs: 120_000,
      // Parola sormak yerine hata versin: panelde yanıtlanacak bir terminal yok.
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
    await load($, repo)
    if (exitCode !== 0) {
      await update($, view, value => ({ ...value, error: firstLine(stderr) }))
    }
  } catch (error) {
    await update($, view, value => ({ ...value, error: String(error) }))
  } finally {
    await update($, view, value => ({ ...value, isBusy: false }))
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(one => typeof one === 'string')
}

function repoLabel(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-graph',
      description: 'Git grafiği panelini açar',
    })

    const storedRepo = await $.store.get('repo')
    const storedRecent = await $.store.get('recent')
    // Eski `zoom` anahtarı boyut hatası varken seçilmişti, bu yüzden okunmuyor.
    const storedZoom = await $.store.get('zoom-level')
    const repo = typeof storedRepo === 'string' ? storedRepo : e.cwd
    const recent = isStringList(storedRecent) ? storedRecent : []
    const zoom = typeof storedZoom === 'number' && ZOOMS.includes(storedZoom) ? storedZoom : DEFAULT_ZOOM
    const mode = (await $.store.get('mode')) === 'svg' ? ('svg' as const) : ('text' as const)
    await update($, view, value => ({
      ...value,
      repo,
      recent: recent.includes(repo) ? recent : [repo, ...recent],
      isBusy: false,
      zoom,
      mode,
    }))

    // Oturum başında ve mod her yeniden yüklendiğinde panel açılır;
    // kapatılırsa /git-graph komutu yeniden açar.
    void $.ui.open({ id: PANE, title: TITLE })
    void load($, repo).catch(() => undefined)
    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        const panes = await $.ui.panes()
        if (!panes.some(pane => pane.id === PANE)) return
        const current = await read($, view)
        if (!current.isBusy) await load($, current.repo)
      })().catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'git-graph' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const { repo } = await read($, view)
    await load($, repo)

    return { text: 'Git grafiği paneli açıldı.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, view)
    const rows = layout(current.commits)
    const width = svgWidth(e.props.bodyColumns)
    const zoomLabel = `%${Math.round(current.zoom * 100)}`
    const zoomIn = () => void stepZoom($, 1).catch(() => undefined)
    const zoomOut = () => void stepZoom($, -1).catch(() => undefined)
    const refresh = () => void load($, current.repo).catch(() => undefined)
    const fetchAll = () => void fetchRemotes($)
    const choose = (path: string) => void selectRepo($, path.trim()).catch(() => undefined)
    const isEmpty = rows.length === 0 && current.error === undefined

    if (e.surface === 'mobile') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const { source, drawn, width: svgPixels, height } = graphSvg(rows, width, current.zoom)

      return (
        <Box flexDirection="column">
          <Text bold>{repoLabel(current.repo)}</Text>
          <Box flexDirection="row">
            <Button key="refresh" onPress={refresh} label="Yenile" />
            <Button key="zoom-out" onPress={zoomOut} label="A−" />
            <Button key="zoom-in" onPress={zoomIn} label="A+" />
          </Box>
          <Text dimColor>{zoomLabel}</Text>
          {current.error !== undefined && <Text bold>Hata: {current.error}</Text>}
          {isEmpty && <Text dimColor>Commit bulunamadı.</Text>}
          {drawn > 0 && (
            <Svg
              source={source}
              alt={`${drawn} commit'lik git grafiği`}
              width={svgPixels}
              height={height}
            />
          )}
        </Box>
      )
    }

    const { Box, Text, Button, Select, Input } = $.ui.resolve(e)
    const isSvgMode = e.surface !== 'terminal' && current.mode === 'svg'
    const controls = (
      <Box flexDirection="column">
        {current.recent.length > 0 && (
          <Select
            key="repo"
            label="Depo"
            value={current.repo}
            options={current.recent.map(path => ({ value: path, label: repoLabel(path) }))}
            onSelect={choose}
          />
        )}
        <Input
          key="path"
          label="Yol"
          placeholder="/depo/yolu"
          submitLabel="Aç"
          onSubmit={choose}
        />
        <Box flexDirection="row">
          <Button key="refresh" label="Yenile" onPress={refresh} />
          <Button
            key="fetch"
            label={current.isBusy ? 'Fetch çalışıyor…' : 'Fetch'}
            onPress={current.isBusy ? () => undefined : fetchAll}
          />
          {e.surface !== 'terminal' && (
            <Button
              key="mode"
              label={current.mode === 'text' ? 'Renkli grafik' : 'Metin grafik'}
              onPress={() => void toggleMode($).catch(() => undefined)}
            />
          )}
          {isSvgMode && <Button key="zoom-out" label="A−" onPress={zoomOut} />}
          {isSvgMode && <Button key="zoom-in" label="A+" onPress={zoomIn} />}
        </Box>
        {isSvgMode && <Text dimColor>{zoomLabel}</Text>}
      </Box>
    )
    const status = (
      <Box flexDirection="column">
        {current.error !== undefined && <Text bold>Hata: {current.error}</Text>}
        {isEmpty && <Text dimColor>Commit bulunamadı.</Text>}
      </Box>
    )

    if (e.surface === 'terminal') {
      const { Code } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {controls}
          {status}
          {rows.length > 0 && <Code source={current.graphText} wrap="truncate-end" />}
        </Box>
      )
    }

    if (current.mode === 'text') {
      const { Code } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {controls}
          {status}
          {rows.length > 0 && <Code source={current.graphText} wrap="truncate-end" />}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const { source, drawn, width: svgPixels, height } = graphSvg(rows, width, current.zoom)

    return (
      <Box flexDirection="column">
        {controls}
        {status}
        {drawn > 0 && (
          <Svg
            source={source}
            alt={`${drawn} commit'lik git grafiği`}
            width={svgPixels}
            height={height}
            isInteractive
          />
        )}
        {current.commits.length >= MAX_COMMITS && (
          <Text dimColor>Son {drawn} commit gösteriliyor.</Text>
        )}
      </Box>
    )
  })
}
