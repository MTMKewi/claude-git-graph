export type RefKind = 'head' | 'branch' | 'remote' | 'tag'

export type Ref = { name: string; kind: RefKind }

export type Commit = {
  hash: string
  parents: string[]
  refs: Ref[]
  shortHash: string
  author: string
  date: string
  subject: string
}

export type View = {
  repo: string
  recent: string[]
  commits: Commit[]
  graphText: string
  error: string | undefined
  isBusy: boolean
  zoom: number
  mode: 'text' | 'svg'
}

declare module 'claude-code' {
  interface PluginState {
    'git-graph': { view: Shaped<View> }
  }
}
