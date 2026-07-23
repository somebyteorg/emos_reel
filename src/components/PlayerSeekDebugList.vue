<script lang="ts" setup>
  import { ChevronDown } from '@lucide/vue'
  import { ref } from 'vue'
  import type { PlaybackSeekDebugEntry } from '@/types/player'

  defineProps<{
    entries: readonly PlaybackSeekDebugEntry[]
  }>()

  const outcomeLabels: Record<PlaybackSeekDebugEntry['outcome'], string> = {
    active: '进行中',
    settled: '已稳定',
    resolved: '已完成',
    superseded: '被替代',
    stopped: '已停止',
  }

  const readerDecisionLabels: Record<PlaybackSeekDebugEntry['readerDecision'], string> = {
    abort: '终止旧流',
    reuse: '复用旧流',
    pending: '判断中',
    none: '无旧流',
  }
  const expandedEntryId = ref<number>()

  function formatTime(seconds?: number) {
    if (seconds == null || !Number.isFinite(seconds)) return '--'
    const value = Math.max(0, Math.round(seconds))
    const hours = Math.floor(value / 3600)
    const minutes = Math.floor((value % 3600) / 60)
    const remainder = value % 60
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`
  }

  function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${Math.round(bytes)} B`
  }

  function formatMs(value?: number) {
    return value == null || !Number.isFinite(value) ? '--' : `${Math.round(value)} ms`
  }

  function seekDuration(entry: PlaybackSeekDebugEntry) {
    if (entry.outcome === 'active' || entry.outcome === 'resolved') return entry.elapsedMs
    return entry.settledMs ?? entry.seekPromiseMs ?? entry.elapsedMs
  }

  function seekScanBytes(entry: PlaybackSeekDebugEntry) {
    const target = entry.byteTargets.at(-1)
    return target == null ? 0 : Math.max(0, entry.readPosition - target)
  }

  function lastRangeTtfb(entry: PlaybackSeekDebugEntry) {
    return entry.rangeTtfbMs.length === entry.rangeStarts.length ? entry.rangeTtfbMs.at(-1) : undefined
  }

  function handleToggle(entryId: number, event: ToggleEvent) {
    const details = event.currentTarget as HTMLDetailsElement
    if (details.open) expandedEntryId.value = entryId
    else if (expandedEntryId.value === entryId) expandedEntryId.value = undefined
  }
</script>

<template>
  <section class="seek-debug">
    <h2>最近定位</h2>
    <p v-if="!entries.length" class="seek-empty">暂无定位记录</p>
    <ol v-else class="seek-list">
      <li v-for="entry in entries" :key="`${entry.createdAt}-${entry.id}`">
        <details :open="expandedEntryId === entry.id" @toggle="handleToggle(entry.id, $event)">
          <summary>
            <span class="seek-title">
              <strong>#{{ entry.id }}</strong>
              {{ formatTime(entry.previousSeconds) }} → {{ formatTime(entry.targetSeconds) }}
            </span>
            <span :class="entry.outcome" class="seek-outcome">{{ outcomeLabels[entry.outcome] }} · {{ formatMs(seekDuration(entry)) }}</span>
            <span class="seek-traffic">
              <span>
                <b>缓存读取</b>
                {{ formatBytes(entry.cacheBytes) }}
              </span>
              <span>
                <b>网络读取</b>
                {{ formatBytes(entry.networkBytes) }}
              </span>
            </span>
            <ChevronDown :size="14" class="seek-chevron" />
          </summary>
          <dl class="seek-metrics">
            <div>
              <dt>旧流处理</dt>
              <dd>{{ readerDecisionLabels[entry.readerDecision] }}</dd>
            </div>
            <div>
              <dt>播放定位</dt>
              <dd>{{ formatMs(entry.seekPromiseMs) }}</dd>
            </div>
            <div>
              <dt>缓存查询</dt>
              <dd>{{ entry.cacheLookups }} 次 / {{ formatMs(entry.cacheLookupMs) }}</dd>
            </div>
            <div>
              <dt>最慢查询</dt>
              <dd>{{ formatMs(entry.slowestCacheLookupMs) }}</dd>
            </div>
            <div>
              <dt>未中次数</dt>
              <dd>{{ entry.cacheMisses }} 次</dd>
            </div>
            <div>
              <dt>范围请求</dt>
              <dd>{{ entry.rangeStarts.length }} 次</dd>
            </div>
            <div>
              <dt>最后范围</dt>
              <dd>{{ entry.rangeStarts.at(-1)?.toLocaleString() ?? '--' }}</dd>
            </div>
            <div>
              <dt>首包耗时</dt>
              <dd>{{ formatMs(lastRangeTtfb(entry)) }}</dd>
            </div>
            <div>
              <dt>追赶丢弃</dt>
              <dd>{{ entry.catchUpEntered ? '发生' : '无' }} / {{ formatBytes(entry.discardedOldStreamBytes) }}</dd>
            </div>
            <div>
              <dt>扫描数据</dt>
              <dd>{{ formatBytes(seekScanBytes(entry)) }}</dd>
            </div>
          </dl>
          <dl class="byte-list">
            <div>
              <dt>定位字节</dt>
              <dd>{{ entry.byteTargets.at(-1)?.toLocaleString() ?? '--' }}</dd>
            </div>
            <div>
              <dt>当前读取</dt>
              <dd>{{ entry.readPosition.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>定位之前</dt>
              <dd>{{ entry.initialBytePosition.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>旧流位置</dt>
              <dd>{{ entry.oldStreamPosition.toLocaleString() }}</dd>
            </div>
          </dl>
        </details>
      </li>
    </ol>
  </section>
</template>

<style scoped>
  .seek-debug {
    padding: 12px 14px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .seek-debug > h2 {
    margin: 0 0 5px;
    color: rgba(255, 255, 255, 0.48);
    font-size: 10px;
    font-weight: 700;
  }
  .seek-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .seek-list li {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  .seek-list li:first-child {
    border-top: 0;
  }
  .seek-list summary {
    display: grid;
    min-height: 61px;
    grid-template-areas:
      'title outcome chevron'
      'traffic traffic chevron';
    grid-template-columns: minmax(0, 1fr) auto 14px;
    align-items: center;
    gap: 3px 10px;
    cursor: pointer;
    list-style: none;
  }
  .seek-list summary::-webkit-details-marker {
    display: none;
  }
  .seek-title {
    grid-area: title;
    min-width: 0;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.75);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seek-title strong {
    margin-right: 5px;
    color: white;
  }
  .seek-outcome {
    grid-area: outcome;
    color: var(--reel-accent-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .seek-outcome.active,
  .seek-outcome.superseded {
    color: var(--reel-film);
  }
  .seek-traffic {
    display: flex;
    min-width: 0;
    grid-area: traffic;
    gap: 14px;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.62);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .seek-traffic span {
    display: flex;
    min-width: 0;
    gap: 5px;
  }
  .seek-traffic b {
    color: rgba(255, 255, 255, 0.36);
    font-weight: 500;
  }
  .seek-chevron {
    grid-area: chevron;
    color: rgba(255, 255, 255, 0.38);
    transition: transform 0.16s ease;
  }
  .seek-list details[open] .seek-chevron {
    transform: rotate(180deg);
  }
  .seek-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px 18px;
    margin: 0;
    padding: 1px 0 12px;
  }
  .seek-metrics > div {
    min-width: 0;
  }
  .seek-metrics dt,
  .byte-list dt {
    color: rgba(255, 255, 255, 0.45);
    font-size: 10px;
    line-height: 1.35;
    white-space: nowrap;
  }
  .seek-metrics dd,
  .byte-list dd {
    min-width: 0;
    overflow: hidden;
    margin: 0;
    color: rgba(255, 255, 255, 0.82);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .byte-list {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 10px 0 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .byte-list > div {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    align-items: baseline;
  }
  .byte-list dd {
    color: rgba(255, 255, 255, 0.5);
  }
  .seek-empty {
    margin: 0;
    padding: 34px 14px;
    color: rgba(255, 255, 255, 0.38);
    font-size: 11px;
    text-align: center;
  }
  @media (max-width: 620px) {
    .seek-metrics {
      column-gap: 10px;
    }
  }
</style>
