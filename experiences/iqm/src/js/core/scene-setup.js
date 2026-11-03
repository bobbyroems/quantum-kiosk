/** Roll back partial construction; successful controllers own their normal disposal. */
export async function withSceneSetup(build) {
  const cleanups = []
  try {
    const controller = await build(cleanup => cleanups.push(cleanup))
    cleanups.length = 0
    return controller
  } catch (error) {
    for (const cleanup of cleanups.reverse()) {
      try { cleanup() } catch (cleanupError) { console.error('Scene setup cleanup failed.', cleanupError) }
    }
    throw error
  }
}
