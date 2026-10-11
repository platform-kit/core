const VERSION = 'v25.0'

export async function sendInstagramPrivateReply({
  accountId,
  commentId,
  text,
  accessToken,
  fetcher = fetch,
}) {
  if (
    typeof accountId !== 'string' || !accountId ||
    typeof commentId !== 'string' || !commentId ||
    typeof text !== 'string' || !text.trim() ||
    typeof accessToken !== 'string' || !accessToken
  ) throw new TypeError('A connected account, comment, reply and access token are required.')

  const response = await fetcher(
    `https://graph.instagram.com/${VERSION}/${encodeURIComponent(accountId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: text.trim() },
      }),
    },
  )
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const definite = response.status >= 400 && response.status < 500
    throw Object.assign(new Error('Instagram did not confirm the private reply.'), {
      code: definite ? 'provider_rejected_reply' : 'provider_outcome_uncertain',
      definite,
    })
  }
  const id = payload?.message_id || payload?.id
  if (typeof id !== 'string' || !id)
    throw Object.assign(new Error('Instagram did not return a private reply id.'), {
      code: 'provider_outcome_uncertain',
      definite: false,
    })
  return { providerResponseId: id }
}

export function automationDeliveryOutcome({ result, error } = {}) {
  if (error) {
    return error.definite === true
      ? { status: 'failed', errorCode: error.code || 'provider_rejected_reply' }
      : { status: 'uncertain', errorCode: 'provider_outcome_uncertain' }
  }
  if (typeof result?.providerResponseId === 'string' && result.providerResponseId)
    return { status: 'sent', providerResponseId: result.providerResponseId }
  return { status: 'uncertain', errorCode: 'provider_outcome_uncertain' }
}
