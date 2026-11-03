export function createNanowireAbortError() {
  return new DOMException('Building a Nanowire mount was aborted', 'AbortError')
}

/**
 * Acquires an asynchronously-created scene without transferring ownership to
 * a mount that was aborted while the scene was being built.
 */
export async function acquireNanowireScene(createScene, isMountInactive) {
  const controller = await createScene()
  if (!isMountInactive()) return controller

  controller?.dispose()
  throw createNanowireAbortError()
}
