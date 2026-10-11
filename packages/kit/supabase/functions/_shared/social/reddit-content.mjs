export function normalizeRedditOptions(value) {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    subreddit: typeof options.subreddit === 'string' ? options.subreddit.trim().replace(/^r\//i, '') : '',
    title: typeof options.title === 'string' ? options.title.trim() : '',
  }
}

export function validateRedditSubmission({ text, media = [], options }) {
  const { subreddit, title } = normalizeRedditOptions(options)
  const issues = []
  if (!/^[A-Za-z0-9_]{1,21}$/.test(subreddit))
    issues.push({ code: 'reddit.subreddit_invalid', message: 'Enter a valid subreddit name.' })
  if (!title || title.length > 300)
    issues.push({ code: 'reddit.title_invalid', message: 'Enter a title between 1 and 300 characters.' })
  if (typeof text !== 'string' || text.length > 40000)
    issues.push({ code: 'reddit.body_too_long', message: 'Reddit self-text posts are limited to 40,000 characters.' })
  if (media.length)
    issues.push({ code: 'reddit.media_unsupported', message: 'Reddit currently supports text-only self posts in this scheduler.' })
  return issues
}

export function redditSubmissionFromApi(body) {
  const errors = body?.json?.errors
  if (Array.isArray(errors) && errors.length) {
    const error = errors[0]
    return { error: { code: String(error?.[0] || 'reddit_rejected'), message: String(error?.[1] || 'Reddit rejected this post.') } }
  }
  const data = body?.json?.data
  if (!data || typeof data.id !== 'string' || !data.id) return { error: null }
  return {
    error: null,
    id: data.id,
    ...(typeof data.url === 'string' ? { url: data.url } : {}),
  }
}
