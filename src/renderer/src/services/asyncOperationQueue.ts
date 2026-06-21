export interface AsyncOperationQueue {
  enqueue<T>(operation: () => Promise<T>): Promise<T>
}

export function createAsyncOperationQueue(): AsyncOperationQueue {
  let queue: Promise<void> = Promise.resolve()

  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const next = queue.catch(() => undefined).then(operation)
      queue = next.then(
        () => undefined,
        () => undefined
      )

      return next
    }
  }
}
