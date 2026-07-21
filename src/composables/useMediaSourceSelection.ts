import { computed, type Ref, watch } from 'vue'
import type { MediaSource, MediaVersion } from '@/api/types'

interface UseMediaSourceSelectionOptions {
  sources: Readonly<Ref<readonly MediaSource[]>>
  isSeries: Readonly<Ref<boolean>>
  seasonNumber: Readonly<Ref<number | null>>
  episodeNumber: Readonly<Ref<number | null>>
  partNumber: Ref<number | null>
  mediaId: Ref<string>
  preferredMediaId?: Readonly<Ref<string | undefined>>
}

export function pickPreferredMediaVersion(versions: readonly MediaVersion[]) {
  return versions.find((version) => /(^|\D)720p?(\D|$)/i.test(version.media_name)) ?? versions.find((version) => /(^|\D)1080p?(\D|$)/i.test(version.media_name)) ?? versions[0]
}

export function useMediaSourceSelection(options: UseMediaSourceSelectionOptions) {
  const episodeSources = computed(() =>
    options.sources.value.filter((source) => {
      if (!options.isSeries.value) return true
      return source.season_number === options.seasonNumber.value && source.episode_number === options.episodeNumber.value
    }),
  )

  const partSources = computed(() => {
    const uniqueSources = new Map<string, MediaSource>()
    for (const source of episodeSources.value) {
      const key = String(source.part_number ?? 'full')
      if (!uniqueSources.has(key)) uniqueSources.set(key, source)
    }
    return [...uniqueSources.values()].sort((a, b) => (a.part_number ?? 0) - (b.part_number ?? 0))
  })

  const selectedSource = computed(() => partSources.value.find((source) => source.part_number === options.partNumber.value) ?? partSources.value[0])
  const versions = computed(() => selectedSource.value?.versions ?? [])
  const selectedVersion = computed(() => versions.value.find((version) => version.media_id === options.mediaId.value))
  const availableEpisodeNumbers = computed(() =>
    [
      ...new Set(
        options.sources.value
          .filter((source) => source.season_number === options.seasonNumber.value && source.episode_number != null && source.versions.length > 0)
          .map((source) => source.episode_number!),
      ),
    ].sort((a, b) => a - b),
  )

  function sourceForEpisode(episodeNumber: number) {
    return options.sources.value
      .filter((source) => source.season_number === options.seasonNumber.value && source.episode_number === episodeNumber && source.versions.length > 0)
      .sort((a, b) => (a.part_number ?? 0) - (b.part_number ?? 0))[0]
  }

  watch(
    partSources,
    (sources) => {
      if (sources.some((source) => source.part_number === options.partNumber.value)) return
      options.partNumber.value = sources[0]?.part_number ?? null
    },
    { immediate: true },
  )

  watch(
    versions,
    (nextVersions) => {
      if (nextVersions.some((version) => version.media_id === options.mediaId.value)) return
      const preferredVersion = nextVersions.find((version) => version.media_id === options.preferredMediaId?.value)
      options.mediaId.value = (preferredVersion ?? pickPreferredMediaVersion(nextVersions))?.media_id ?? ''
    },
    { immediate: true },
  )

  return {
    availableEpisodeNumbers,
    episodeSources,
    partSources,
    selectedSource,
    selectedVersion,
    sourceForEpisode,
    versions,
  }
}
