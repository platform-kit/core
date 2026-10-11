/* Contentful's error envelope and ids — plain JavaScript */
const make = (id, message, status, details) => ({ status, body: { sys: { type: 'Error', id }, message, ...(details ? { details } : {}), requestId: Math.random().toString(36).slice(2, 12) } })
export const ERR = {
  notFound: (what = 'The resource could not be found.', details) => make('NotFound', what, 404, details),
  badQuery: (message, details) => make('BadQuery', message, 400, details),
  invalidQuery: (message, details) => make('InvalidQuery', message, 400, details),
  unknownType: (id) => make('InvalidQuery', 'The content type could not be found.', 400, { errors: [{ name: 'unknownContentType', value: 'DOESNOTEXIST' }] }),
  token: (message = 'The access token you sent could not be found or is invalid.') => make('AccessTokenInvalid', message, 401),
  denied: (message = 'You do not have permission to perform this action.') => make('AccessDenied', message, 403),
  rate: (reset) => make('RateLimitExceeded', 'You have exceeded the rate limit of the Organization for this action. Retry after ' + reset + ' seconds.', 429),
  method: () => make('BadRequest', 'This method is not allowed.', 405),
}
