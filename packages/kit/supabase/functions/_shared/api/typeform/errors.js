/* Typeform's error envelope: { code, description }, and the codes the Forms API answers with */
export const ERR = {
  NOT_FOUND: [404, 'NOT_FOUND', 'Not found.'],
  AUTHENTICATION_FAILED: [401, 'AUTHENTICATION_FAILED', 'Authentication credentials not found on the Request Headers.'],
  FORBIDDEN: [403, 'FORBIDDEN', 'You do not have permission to perform this action.'],
  BAD_REQUEST: [400, 'BAD_REQUEST', 'The request is malformed.'],
  METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'],
  TOO_MANY_REQUESTS: [429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded.'],
  VALIDATION_ERROR: [400, 'VALIDATION_ERROR', 'The request is not valid.'],
}
export function errorOf(code, description, details) {
  const [status, c, d] = ERR[code] || ERR.BAD_REQUEST
  return { status, body: { code: c, description: description || d, ...(details ? { details } : {}) } }
}
