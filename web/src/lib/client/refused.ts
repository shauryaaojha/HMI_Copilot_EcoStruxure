/**
 * The server answered, and the answer was no. Kept apart from a failed fetch,
 * because "you are offline" is the wrong thing to tell someone who has hit a
 * limit: waiting for the network will not save their work.
 */
export class ServerRefused extends Error {}
