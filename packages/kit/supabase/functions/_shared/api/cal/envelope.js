/* cal.com's envelope: { status: 'success', data } and { status: 'error', error: { code, message, details? } } */
export const ok = (data) => ({ status: 'success', data })
export const fail = (status, code, message, details) => ({ status, body: { status: 'error', error: { code, message, ...(details ? { details } : {}) } } })
export const CODES = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 402: 'PAYMENT_REQUIRED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 429: 'TOO_MANY_REQUESTS', 500: 'INTERNAL_SERVER_ERROR', 502: 'BAD_GATEWAY', 503: 'SERVICE_UNAVAILABLE' }
