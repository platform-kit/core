/**
 * Resolve one provider call without repeating a potentially accepted publication.
 *
 * @param {{
 *   publishResult?: { outcome?: string, providerPostId?: string, publishedAt?: string, code?: string, message?: string, retryDisposition?: { kind?: string, delayMs?: number } },
 *   publishError?: unknown,
 *   reconcile: (providerPostId?: string) => Promise<{ outcome?: string, providerPostId?: string, publishedAt?: string }>,
 *   onKnownFailure: (failure: { code?: unknown, message?: unknown, disposition?: { kind?: string, delayMs?: number } }) => { status: 'retry_wait' | 'failed' | 'blocked', errorCode?: string, error?: string, nextAttemptAt?: string },
 * }} input
 * @returns {Promise<{ status: 'published', providerPostId: string } | { status: 'retry_wait' | 'failed' | 'blocked', errorCode?: string, error?: string, nextAttemptAt?: string } | { status: 'review_required', errorCode: string, error: string }>}
 */
export async function resolveSocialOutcome({ publishResult, publishError, reconcile, onKnownFailure }) {
  if (publishResult?.outcome === 'published' && publishResult.providerPostId) {
    return { status: 'published', providerPostId: publishResult.providerPostId }
  }

  if (publishResult?.outcome === 'failed' && !publishError
      && publishResult.retryDisposition?.kind !== 'reconcile-first') {
    return onKnownFailure({
      code: publishResult.code,
      message: publishResult.message,
      disposition: publishResult.retryDisposition,
    })
  }

  const providerPostId = publishResult?.providerPostId
  const reconciled = await reconcile(providerPostId)
  if (reconciled.outcome === 'published' && reconciled.providerPostId) {
    return { status: 'published', providerPostId: reconciled.providerPostId }
  }

  const uncertainCode = publishError ? 'provider_outcome_uncertain'
    : publishResult?.code || 'provider_outcome_uncertain'
  return {
    status: 'review_required',
    errorCode: uncertainCode,
    error: 'The provider outcome is uncertain; review this post before retrying.',
  }
}
