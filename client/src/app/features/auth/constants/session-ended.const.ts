/**
 * A session the client ends on its own hands the user to `/login` with this
 * marker, so the login page can say why the user was signed out.
 */
export const SESSION_ENDED_PARAM = 'session_ended';

export const SESSION_ENDED = {
  /** No input in any tab for the idle timeout. */
  Idle: 'idle'
} as const;

export type SessionEndedValue =
  (typeof SESSION_ENDED)[keyof typeof SESSION_ENDED];
