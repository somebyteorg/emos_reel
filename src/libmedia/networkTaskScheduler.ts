export type NetworkTaskPriority = 'seek' | 'playback' | 'prefetch'

interface ScheduledNetworkTask<T> {
  cleanupAbort?: () => void
  key?: string
  priority: NetworkTaskPriority
  reject: (error: unknown) => void
  resolve: (value: T) => void
  run: () => Promise<T>
  sequence: number
  signal?: AbortSignal
}

const priorityValue: Record<NetworkTaskPriority, number> = {
  seek: 3,
  playback: 2,
  prefetch: 1,
}

function abortError() {
  return new DOMException('Network task aborted', 'AbortError')
}

/** Serializes access to one HTTP reader while allowing foreground work to overtake queued prefetch work. */
export class NetworkTaskScheduler {
  private active = false
  private sequence = 0
  private stopped = false
  private readonly keyedTasks = new Map<string, Promise<unknown>>()
  private readonly queue: ScheduledNetworkTask<unknown>[] = []

  schedule<T>(priority: NetworkTaskPriority, run: () => Promise<T>, options: { key?: string; signal?: AbortSignal } = {}) {
    if (this.stopped || options.signal?.aborted) return Promise.reject<T>(abortError())
    if (options.key) {
      const existing = this.keyedTasks.get(options.key)
      if (existing) return existing as Promise<T>
    }

    let task!: ScheduledNetworkTask<T>
    const operation = new Promise<T>((resolve, reject) => {
      task = {
        key: options.key,
        priority,
        reject,
        resolve,
        run,
        sequence: this.sequence++,
        signal: options.signal,
      }
      if (options.signal) {
        const cancelQueuedTask = () => {
          const index = this.queue.indexOf(task as ScheduledNetworkTask<unknown>)
          if (index < 0) return
          this.queue.splice(index, 1)
          task.cleanupAbort?.()
          task.reject(abortError())
        }
        options.signal.addEventListener('abort', cancelQueuedTask, { once: true })
        task.cleanupAbort = () => options.signal?.removeEventListener('abort', cancelQueuedTask)
        if (options.signal.aborted) {
          task.cleanupAbort()
          reject(abortError())
          return
        }
      }
      this.queue.push(task as ScheduledNetworkTask<unknown>)
      this.queue.sort((left, right) => priorityValue[right.priority] - priorityValue[left.priority] || left.sequence - right.sequence)
      this.pump()
    })
    if (options.key) {
      this.keyedTasks.set(options.key, operation)
      void operation
        .finally(() => {
          if (this.keyedTasks.get(options.key!) === operation) this.keyedTasks.delete(options.key!)
        })
        .catch(() => undefined)
    }
    return operation
  }

  cancel(priority?: NetworkTaskPriority) {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const task = this.queue[index]!
      if (priority && task.priority !== priority) continue
      this.queue.splice(index, 1)
      task.cleanupAbort?.()
      task.reject(abortError())
    }
  }

  reset() {
    this.cancel()
    this.stopped = false
  }

  stop() {
    this.stopped = true
    this.cancel()
  }

  private pump() {
    if (this.active || this.stopped) return
    const task = this.queue.shift()
    if (!task) return
    task.cleanupAbort?.()
    if (task.signal?.aborted) {
      task.reject(abortError())
      this.pump()
      return
    }
    this.active = true
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        this.active = false
        this.pump()
      })
  }
}
