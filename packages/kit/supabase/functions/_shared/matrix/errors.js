/*
 * MATRIX'S ERROR SHAPE, WITH A REASON A PERSON CAN ACT ON.
 *
 * Matrix answers a refusal as `{ errcode, error }`, and clients show `error` to whoever is sitting
 * there. A bare code — "M_FORBIDDEN" — is what most homeservers send and it tells that person
 * nothing: they cannot know whether they typed the wrong password, are not in the room, or have
 * asked for something this server does not do at all.
 *
 * So every refusal here names the reason. They are written out rather than composed, because a
 * message built out of fragments at the call site is how a refusal ends up saying "cannot cannot".
 *
 * These are not reader-facing strings in the markdown sense: they are protocol, read by a client
 * in whatever language it runs in, and a site does not edit them. What a person sees in OUR
 * interface is markdown as always.
 */

export const M = {
  FORBIDDEN: 'M_FORBIDDEN',
  UNKNOWN_TOKEN: 'M_UNKNOWN_TOKEN',
  MISSING_TOKEN: 'M_MISSING_TOKEN',
  BAD_JSON: 'M_BAD_JSON',
  NOT_JSON: 'M_NOT_JSON',
  NOT_FOUND: 'M_NOT_FOUND',
  LIMIT_EXCEEDED: 'M_LIMIT_EXCEEDED',
  UNKNOWN: 'M_UNKNOWN',
  UNRECOGNIZED: 'M_UNRECOGNIZED',
  UNAUTHORIZED: 'M_UNAUTHORIZED',
  USER_DEACTIVATED: 'M_USER_DEACTIVATED',
  INVALID_USERNAME: 'M_INVALID_USERNAME',
  EXCLUSIVE: 'M_EXCLUSIVE',
  TOO_LARGE: 'M_TOO_LARGE',
  UNSUPPORTED_ROOM_VERSION: 'M_UNSUPPORTED_ROOM_VERSION',
}

/* a refusal: the code, the sentence, the status, and — for a rate limit — how long to wait */
export const refusal = (errcode, error, status = 400, extra = null) =>
  ({ status, body: { errcode, error, ...(extra || {}) } })

export const REFUSALS = {
  noToken: () => refusal(M.MISSING_TOKEN, 'This request carried no access token. Sign in with your site password to get one.', 401),
  badToken: () => refusal(M.UNKNOWN_TOKEN, 'That access token is not one of ours, or it has been signed out. Sign in again.', 401),
  expired: () => refusal(M.UNKNOWN_TOKEN, 'Your session has ended — the password may have been changed, or you signed out everywhere. Sign in again.', 401),
  badLogin: () => refusal(M.FORBIDDEN, 'That email and password do not match an account on this site.', 403),
  tooManyLogins: (seconds) => refusal(M.LIMIT_EXCEEDED, `Too many sign-in attempts from here. Try again in ${Math.ceil(seconds / 60)} minutes.`, 429, { retry_after_ms: seconds * 1000 }),
  noRegister: (where) => refusal(M.FORBIDDEN, `This server does not create accounts. Sign up at ${where}, then sign in here with the same email and password.`, 403),
  notInRoom: () => refusal(M.FORBIDDEN, 'You are not in that room, or it does not exist. Rooms here follow your membership of the space they belong to.', 403),
  noSuchRoom: () => refusal(M.NOT_FOUND, 'There is no room with that id on this server.', 404),
  /* an upload that storage itself refused. It says so plainly: the old code answered this with
     "you may read this room but not write in it", which named a room an upload does not have. */
  cannotStage: (why) => refusal(M.FORBIDDEN, `That file could not be stored${why ? ': ' + why : '.'}`, 403),
  /* a backup that does not exist, which is every day here: no room is encrypted, so there is
     nothing to back up. M_NOT_FOUND rather than M_UNRECOGNIZED, because a client reads the first
     as "none yet" and the second as "this server is too old to ask". */
  noKeyBackup: () => refusal(M.NOT_FOUND, 'No key backup: no room on this site is encrypted.', 404),
  foreign: (host) => refusal(M.FORBIDDEN, `This server does not federate, so it cannot reach a room on ${host}. Only rooms on this site are available.`, 403),
  readOnlyState: (what) => refusal(M.FORBIDDEN, `${what} is decided by this site and cannot be set from a client. Change it where the site is administered.`, 403),
  cannotSend: () => refusal(M.FORBIDDEN, 'You may read this room but not write in it.', 403),
  noEncryption: () => refusal(M.FORBIDDEN, 'This server does not support end-to-end encryption: the site reads its own rooms for search, moderation and its assistants.', 403),
  /* …except in a room whose own file asked for it, where the two refusals are the other way round */
  notSealed: () => refusal(M.FORBIDDEN, 'This room is not encrypted. A room is sealed by its own file, and sending a ciphertext into an open one would leave a line nobody can ever read.', 403),
  mustSeal: () => refusal(M.FORBIDDEN, 'This room is end-to-end encrypted. Send m.room.encrypted: a plain message here would be words in a timeline everybody else is sealing.', 403),
  unsupported: (what) => refusal(M.UNRECOGNIZED, `This server does not implement ${what}.`, 404),
  tooLarge: (mb) => refusal(M.TOO_LARGE, `That file is larger than the ${mb} MB this site accepts.`, 413),
  keyNotMatrix: () => refusal(M.FORBIDDEN, 'That API key is not of kind matrix, so it cannot be used here.', 403),
  keyNotGranted: () => refusal(M.FORBIDDEN, 'That key has not been granted this room.', 403),
  badJson: () => refusal(M.BAD_JSON, 'The body of that request was not the JSON this endpoint expects.', 400),
}

/* every refusal says something, and this is what the test asserts rather than trusting the review */
export const speaks = (r) => !!(r && r.body && typeof r.body.error === 'string' && r.body.error.trim().length > 20 && r.body.error !== r.body.errcode)
