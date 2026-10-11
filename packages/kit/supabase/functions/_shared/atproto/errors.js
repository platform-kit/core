/*
 * WHAT THE SURFACE SAYS WHEN IT SAYS NO — in XRPC's own shape, { error, message } with the status the
 * protocol expects, so a client reads the reason rather than a timeout. A refusal names why: a closed
 * network, an account made on the site and nowhere else, a method this site does not have.
 */
export const xerr = (status, error, message) => ({ status, body: { error, message } })

export const REFUSALS = {
  badRequest: (m) => xerr(400, 'InvalidRequest', m),
  auth: () => xerr(401, 'AuthenticationRequired', 'Sign in with an app password made on your account page.'),
  badLogin: () => xerr(401, 'AuthenticationRequired', 'Invalid identifier or password. Use an app password made on your account page, never your site password.'),
  expired: () => xerr(400, 'ExpiredToken', 'Token has expired'),
  invalidToken: () => xerr(400, 'InvalidToken', 'Token could not be verified'),
  tooMany: (s) => xerr(429, 'RateLimitExceeded', `Too many wrong passwords from this address; try again in ${Math.ceil(s / 60)} minutes.`),
  noAccount: (where) => xerr(400, 'InvalidRequest', `Accounts on this network are made on the site itself${where ? ' — ' + where : ''}.`),
  noHandle: () => xerr(400, 'InvalidRequest', 'This account has no username yet: choose one on your account page, and it becomes your handle.'),
  notFound: (what = 'Record') => xerr(400, 'RecordNotFound', `${what} not found`),
  noProfile: () => xerr(400, 'InvalidRequest', 'Profile not found'),
  forbidden: (m) => xerr(403, 'Forbidden', m || 'Not allowed'),
  invalid: (m) => xerr(400, 'InvalidRecord', m),
  closed: () => xerr(400, 'MethodNotImplemented', 'This network is closed to the outside: it answers only its own people, and asks nothing of other servers.'),
  notJoined: () => xerr(400, 'InvalidRequest', 'Reaching people elsewhere on the network needs your account to have joined the wider network, on your account page.'),
  unsupported: (nsid) => xerr(501, 'MethodNotImplemented', `${nsid} is not something this site serves.`),
  off: () => xerr(404, 'MethodNotImplemented', 'The social network is not on for this site.'),
  noApps: () => xerr(403, 'Forbidden', 'This site does not let other apps sign in. Use the site itself.'),
}
