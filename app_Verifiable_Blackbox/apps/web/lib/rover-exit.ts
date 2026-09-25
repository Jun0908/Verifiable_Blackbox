export function canLeaveWithoutStop(session: string | undefined, state: string | undefined) {
  // No owned session, or a bridge that has already disposed of the connection.
  return !session || state === "idle" || state === "error" || state === "offline";
}
