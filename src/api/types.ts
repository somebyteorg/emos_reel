export interface ReelInfo {
  todbv_id: number
  video_list_id: number
  video_type: 'movie' | 'tv' | string
  video_title: string
  video_runtime: number | null
  video_record: ReelVideoRecord | null
}

export interface ReelVideoRecord {
  video_season_id: number | null
  season_number: number | null
  season_title: string | null
  video_episode_id: number | null
  episode_number: number | null
  episode_title: string | null
  video_part_id: number | null
  part_number: number | null
  part_title: string | null
  media_id: string | null
  media_name: string | null
  media_second: number | null
  play_seconds: number | null
  is_complete: boolean
}

export interface RandomReelResponse {
  forge_reel_uuid: string
}

export interface UserBase {
  user_id: string
  username: string
  avatar: string | null
}

export interface VideoInfo {
  video_id: number
  video_type: 'movie' | 'tv' | string
  video_title: string
  video_description: string
  tagline: string | null
  runtime: number | null
  status: string
  origin_title: string | null
  origin_countrys: string[]
  original_languages: string[]
  vote_average: number | null
  vote_count: number | null
  date_air: string | null
  is_adult: boolean
  image_poster: string | null
  image_backdrop: string | null
  image_logo: string | null
  genre_ids: Array<number | string>
}

export interface TodbVideoListItem {
  video_id: number
  video_type: 'movie' | 'tv'
  video_title: string
  video_description: string
  video_tagline: string | null
  origin_title: string | null
  origin_countrys: string[]
  original_languages: string[]
  vote_average: number | null
  vote_count: number | null
  date_air: string | null
  is_adult: boolean
  image_poster: string | null
}

export interface TodbVideoListResponse {
  page: number
  page_size: number
  total: number
  items: TodbVideoListItem[]
}

export interface VideoImage {
  image_id: number
  image_path: string
  type: 'backdrop' | 'poster' | 'logo' | string
  language: string | null
  width: number | null
  height: number | null
  is_default: boolean
}

export interface SeasonInfo {
  season_id: number
  season_number: number
  season_title: string
  season_description: string
  date_air: string | null
  image_poster: string | null
  episode_count?: number
}

export interface EpisodeInfo {
  season_id: number
  season_number?: number
  episode_id: number
  episode_number: number
  episode_title: string
  episode_description: string
  runtime: number | null
  date_air: string | null
  image_poster: string | null
  parts_count?: number
}

export interface VideoDictionary {
  genre?: Array<{ id: number | string; name: string }>
  [key: string]: unknown
}

export interface MediaMetadataStream {
  index?: number
  codec_name?: string
  codec_long_name?: string
  profile?: string
  codec_type?: string
  width?: number
  height?: number
  coded_width?: number
  coded_height?: number
  pix_fmt?: string
  color_transfer?: string
  color_primaries?: string
  color_space?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  bit_rate?: string | number
  sample_rate?: string | number
  channels?: number
  channel_layout?: string
  disposition?: Record<string, number | boolean | null | undefined>
  tags?: Record<string, string | number | null | undefined>
  [key: string]: unknown
}

export interface MediaMetadataFormat {
  format_name?: string
  format_long_name?: string
  duration?: string | number
  size?: string | number
  bit_rate?: string | number
  [key: string]: unknown
}

export interface MediaMetadata {
  streams?: MediaMetadataStream[]
  format?: MediaMetadataFormat
  [key: string]: unknown
}

export interface MediaVersion {
  media_id: string
  media_name: string
  media_size: number
  media_second: number
  media_metadata?: MediaMetadata | null
  storage_title: string | null
}

export interface MediaSource {
  video_season_id: number | null
  season_number: number | null
  video_episode_id: number | null
  episode_number: number | null
  video_part_id: number | null
  part_number: number | null
  play_seconds: number | null
  is_complete: boolean
  last_played: string | null
  versions: MediaVersion[]
}

export interface MediaDetail {
  video_id: number
  video_type: 'movie' | 'tv' | null
  video_title: string | null
  todb_id?: number | null
  season_id: number | null
  season_number: number | null
  season_title: string | null
  episode_id: number | null
  episode_number: number | null
  episode_title: string | null
  part_id: number | null
  part_number: number | null
  part_title: string | null
  media_id: string
  media_name: string
  media_status: string
  media_file_size: number
  media_file_second: number
  media_file_metadata?: MediaMetadata | null
  media_metadata?: MediaMetadata | null
  storage_title?: string | null
}

export interface ManifestSubtitle {
  type: string
  language?: string
  title: string
  url: string
}

export interface ManifestSprite {
  base_url: string
  frame_times: number[]
  width: number
  height: number
  columns: number
  rows: number
  count_frame: number
  files: string[]
}

interface PlaybackManifestBase {
  forge_reel_uuid: string
  video_list_id: number
  video_season_id: number | null
  video_episode_id: number | null
  video_part_id: number | null
  subtitles: ManifestSubtitle[]
  sprites: ManifestSprite[]
  media_name: string
  media_size: number
  media_second: number
}

/**
 * Direct file playback (MKV/MP4/…) — frontend POSTs to play_url with
 * `play_data.data` as the JSON body and streams the response bytes.
 */
export type UrlPlaybackManifest = PlaybackManifestBase & {
  play_type: 'url'
  play_data: { play_url: string; data: unknown }
}

/** Segmented HLS playback — frontend uses Shaka Player. */
export type M3u8PlaybackManifest = PlaybackManifestBase & {
  play_type: 'm3u8'
  play_data: { m3u8_master: string }
}

export type PlaybackManifest = UrlPlaybackManifest | M3u8PlaybackManifest

export interface PlaybackProgressPayload {
  media_id: string
  play_speed: number
  play_seconds: number
}
