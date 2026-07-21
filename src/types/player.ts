import type shaka from 'shaka-player'

export interface SubtitleOption {
  track: shaka.extern.TextTrack
  title: string
  language: string
}

export type SubtitleFontSize = 'system' | 'small' | 'medium' | 'large'
export type SubtitlePosition = 'system' | 'bottom' | 'raised' | 'middle'
export type SubtitleBackgroundMode = 'system' | 'custom'

export interface PlayerBufferedRange {
  start: number
  end: number
}

export interface PlaybackAudioOption {
  id: string
  label: string
  language: string
  channelsCount: number | null
}

export interface PlayerDebugSnapshot {
  downloadSpeed: string
  estimatedBandwidth: string
  streamBandwidth: string
  bufferAhead: string
  viewport: string
  resolution: string
  droppedFrames: string
  codecs: string
  mediaId: string
  mediaName: string
}
