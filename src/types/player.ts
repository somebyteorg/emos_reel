export interface SubtitleOption {
  id: string | number
  title: string
  language: string
}

export type SubtitleFontSize = 'system' | 'small' | 'medium' | 'large'
export type SubtitlePosition = 'system' | 'bottom' | 'raised' | 'middle'
export type SubtitleBackgroundMode = 'system' | 'custom'
export type PlaybackReadSource = 'network' | 'cache'
export type PlaybackDecoderMode = 'wasm' | 'webcodecs'

export interface PlayerBufferedRange {
  start: number
  end: number
  kind: 'stored' | 'ready'
}

export interface PlaybackAudioOption {
  id: string
  label: string
  language: string
  channelsCount: number | null
}

export interface PlaybackSeekDebugEntry {
  id: number
  createdAt: number
  elapsedMs: number
  previousSeconds?: number
  targetSeconds: number
  readerDecision: 'abort' | 'reuse' | 'pending' | 'none'
  initialBytePosition: number
  oldStreamPosition: number
  byteTargets: number[]
  readPosition: number
  cacheBytes: number
  cacheLookups: number
  cacheLookupMs: number
  slowestCacheLookupMs: number
  cacheMisses: number
  networkBytes: number
  rangeStarts: number[]
  rangeTtfbMs: number[]
  discardedOldStreamBytes: number
  catchUpEntered: boolean
  seekPromiseMs?: number
  settledMs?: number
  outcome: 'active' | 'settled' | 'resolved' | 'superseded' | 'stopped'
}

export interface PlayerDebugSnapshot {
  showLibmediaDiagnostics: boolean
  readStatus: string
  bufferDiagnostics: string
  persistentReadAhead: string
  streamState: string
  estimatedBandwidth: string
  streamBandwidth: string
  viewport: string
  resolution: string
  droppedFrames: string
  codecs: string
  mediaCache: string
  mediaId: string
  mediaName: string
  storageLocation: string
  seekLogs: PlaybackSeekDebugEntry[]
}
