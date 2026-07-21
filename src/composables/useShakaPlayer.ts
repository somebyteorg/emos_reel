import { ref, type Ref } from 'vue'
import shaka from 'shaka-player/dist/shaka-player.hls.js'
import type { PlaybackAudioOption } from '@/types/player'
import { audioTrackId, audioTrackLabel, calculateTransferSpeed, type TransferSample } from '@/utils/player-metrics'

interface UseShakaPlayerOptions {
  videoElement: Ref<HTMLVideoElement | undefined>
  getToken: () => string | undefined
  onError: (error: shaka.util.Error, critical: boolean) => void
  onStatsChanged: () => void
}

interface LoadShakaPlayerOptions {
  manifestText: string
  startTime: number
  preferredAudioId?: string
}

export function useShakaPlayer(options: UseShakaPlayerOptions) {
  const audioOptions = ref<PlaybackAudioOption[]>([])
  const selectedAudioId = ref('')
  const segmentDownloadBitsPerSecond = ref(0)
  const lastSegmentDownloadAt = ref(0)
  const transferSamples: TransferSample[] = []
  let player: shaka.Player | undefined
  let playlistUrl = ''
  let lifecycleVersion = 0

  function getPlayer() {
    return player
  }

  function getStats() {
    return player?.getStats()
  }

  function refreshAudioOptions(targetPlayer = player) {
    if (!targetPlayer || targetPlayer !== player) return
    const audioTracks = targetPlayer.getAudioTracks()
    audioOptions.value = audioTracks.map((track) => ({
      id: audioTrackId(track),
      label: audioTrackLabel(track),
      language: track.language,
      channelsCount: track.channelsCount,
    }))
    const activeAudio = audioTracks.find((track) => track.active) ?? audioTracks[0]
    selectedAudioId.value = activeAudio ? audioTrackId(activeAudio) : ''
  }

  function selectAudioTrack(id: string) {
    if (!player) return false
    const track = player.getAudioTracks().find((item) => audioTrackId(item) === id)
    if (!track) return false
    player.selectAudioTrack(track, 8)
    selectedAudioId.value = id
    return true
  }

  function registerNetworkingFilters(targetPlayer: shaka.Player) {
    const networkingEngine = targetPlayer.getNetworkingEngine()
    networkingEngine?.registerRequestFilter((_type, request) => {
      const requestsEmos = request.uris.some((uri) => {
        const parsed = new URL(uri, window.location.origin)
        return parsed.origin === 'https://emos.best' || (parsed.origin === window.location.origin && parsed.pathname.startsWith('/emos/'))
      })
      const token = options.getToken()
      if (token && requestsEmos) request.headers.Authorization = `Bearer ${token}`
    })
    networkingEngine?.registerResponseFilter((type, response, requestContext) => {
      if (
        targetPlayer !== player ||
        type !== shaka.net.NetworkingEngine.RequestType.SEGMENT ||
        !requestContext?.stream ||
        !['audio', 'video'].includes(requestContext.stream.type) ||
        requestContext.type !== shaka.net.NetworkingEngine.AdvancedRequestType.MEDIA_SEGMENT ||
        response.fromCache ||
        !response.timeMs ||
        response.timeMs <= 0
      )
        return
      const endedAt = Date.now()
      transferSamples.push({
        bytes: response.data.byteLength,
        startedAt: endedAt - response.timeMs,
        endedAt,
      })
      segmentDownloadBitsPerSecond.value = calculateTransferSpeed(transferSamples, endedAt)
      lastSegmentDownloadAt.value = endedAt
      options.onStatsChanged()
    })
  }

  function registerPlayerEvents(targetPlayer: shaka.Player) {
    targetPlayer.addEventListener('error', (event) => {
      if (targetPlayer !== player) return
      const playbackError = (event as CustomEvent<shaka.util.Error>).detail
      if (!playbackError) {
        console.error('[EMOS REEL] Shaka playback error event', event)
        return
      }
      console.error(
        '[EMOS REEL] Shaka playback error',
        {
          severity: playbackError.severity,
          category: playbackError.category,
          code: playbackError.code,
          data: playbackError.data,
          handled: playbackError.handled,
          message: playbackError.message,
        },
        playbackError,
      )
      options.onError(playbackError, playbackError.severity === shaka.util.Error.Severity.CRITICAL)
    })
    targetPlayer.addEventListener('trackschanged', () => refreshAudioOptions(targetPlayer))
    targetPlayer.addEventListener('adaptation', () => {
      if (targetPlayer === player) options.onStatsChanged()
    })
    targetPlayer.addEventListener('variantchanged', () => {
      if (targetPlayer === player) options.onStatsChanged()
    })
  }

  async function load({ manifestText, startTime, preferredAudioId }: LoadShakaPlayerOptions) {
    const video = options.videoElement.value
    if (!video) throw new Error('Video element is unavailable')
    shaka.polyfill.installAll()
    if (!shaka.Player.isBrowserSupported()) throw new Error('Unsupported browser')

    if (player || playlistUrl) await destroy()
    const currentVersion = ++lifecycleVersion
    const currentPlayer = new shaka.Player()
    player = currentPlayer
    await currentPlayer.attach(video)
    if (currentVersion !== lifecycleVersion || currentPlayer !== player) {
      await currentPlayer.destroy()
      throw new Error('Shaka load superseded')
    }
    currentPlayer.configure({
      preferredTextLanguage: 'zh-CN',
      streaming: { bufferingGoal: 30, rebufferingGoal: 2 },
      abr: { enabled: false },
    })
    registerNetworkingFilters(currentPlayer)
    registerPlayerEvents(currentPlayer)

    const currentPlaylistUrl = URL.createObjectURL(new Blob([manifestText], { type: 'application/x-mpegurl' }))
    playlistUrl = currentPlaylistUrl
    await currentPlayer.load(currentPlaylistUrl, startTime, 'application/x-mpegurl')
    if (currentVersion !== lifecycleVersion || currentPlayer !== player) {
      throw new Error('Shaka load superseded')
    }
    refreshAudioOptions(currentPlayer)
    if (preferredAudioId && audioOptions.value.some((audio) => audio.id === preferredAudioId)) {
      selectAudioTrack(preferredAudioId)
    }
  }

  async function destroy() {
    lifecycleVersion += 1
    const currentPlayer = player
    const currentPlaylistUrl = playlistUrl
    player = undefined
    playlistUrl = ''
    try {
      if (currentPlayer) await currentPlayer.destroy()
    } finally {
      if (currentPlaylistUrl) URL.revokeObjectURL(currentPlaylistUrl)
      audioOptions.value = []
      selectedAudioId.value = ''
      segmentDownloadBitsPerSecond.value = 0
      lastSegmentDownloadAt.value = 0
      transferSamples.length = 0
    }
  }

  return {
    audioOptions,
    destroy,
    getPlayer,
    getStats,
    lastSegmentDownloadAt,
    load,
    segmentDownloadBitsPerSecond,
    selectAudioTrack,
    selectedAudioId,
  }
}
