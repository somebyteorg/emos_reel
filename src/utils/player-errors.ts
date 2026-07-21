import type shaka from 'shaka-player'

export const fallbackPlaybackErrorMessage = '播放错误，可能不支持当前设备'

export function formatUnknownPlaybackError(error: unknown, mediaId: string) {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : `加载播放清单失败 请进行反馈 ${mediaId}`
}

export function playbackErrorUserMessage(error: shaka.util.Error) {
  switch (error.code) {
    case 1001:
      return '视频请求失败，请稍后重试'
    case 1002:
      return '无法连接视频服务，请检查网络后重试'
    case 1003:
      return '视频加载超时，请检查网络后重试'
    case 1010:
      return '多次连接视频服务失败，请稍后重试'
    case 1011:
      return '视频片段暂时不可用，请稍后重试'
    case 3014:
    case 3015:
      return '浏览器无法载入视频片段，请重新载入'
    case 3017:
      return '播放缓冲空间不足，请关闭其他视频页面后重试'
    case 3018:
      return '视频片段处理失败，暂时无法播放'
    case 6000:
    case 6001:
    case 6020:
      return '当前浏览器不支持此视频的版权保护'
    case 6002:
    case 6003:
    case 6004:
    case 6005:
    case 6006:
      return '浏览器无法启动视频解密，请更换浏览器或设备'
    case 6007:
      return '无法获取播放许可，请检查网络后重试'
    case 6008:
      return '播放许可无效，暂时无法播放'
    case 6010:
      return '视频加密信息不完整，暂时无法播放'
    case 6012:
      return '播放许可服务未配置，暂时无法播放'
    case 6014:
      return '播放许可已过期，请重新载入'
    case 6018:
      return '当前设备的内容保护等级不足'
    default:
      return fallbackPlaybackErrorMessage
  }
}
