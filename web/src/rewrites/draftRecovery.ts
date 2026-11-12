export function readDraftRecovery(projectID: string): Record<string, unknown> {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("rednote.draft-recovery." + projectID) || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
export function backupDraft(projectID: string, scope: string, value?: unknown) {
  try {
    const all = readDraftRecovery(projectID);
    if (value === undefined) delete all[scope];
    else all[scope] = value;
    if (Object.keys(all).length)
      sessionStorage.setItem(
        "rednote.draft-recovery." + projectID,
        JSON.stringify(all),
      );
    else sessionStorage.removeItem("rednote.draft-recovery." + projectID);
  } catch {
    /* Saving on the server remains available when session storage is disabled. */
  }
}
