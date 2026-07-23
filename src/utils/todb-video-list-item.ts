import dayjs from 'dayjs'
import { imageUrl } from '@/api/todb'
import type { TodbVideoListItem } from '@/api/types'

export function todbVideoTypeLabel(type: TodbVideoListItem['video_type']) {
  return type === 'movie' ? '电影' : '剧集'
}

export function todbYearLabel(item: TodbVideoListItem) {
  return item.date_air && dayjs(item.date_air).isValid() ? dayjs(item.date_air).format('YYYY') : '年份未知'
}

export function todbPosterUrl(item: TodbVideoListItem) {
  return imageUrl(item.image_poster, 'w300')
}

export function todbSpotlightPosterUrl(item: TodbVideoListItem) {
  return imageUrl(item.image_poster, 'w500')
}
