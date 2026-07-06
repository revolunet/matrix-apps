// Central place for the localStorage/sessionStorage keys that make up a
// matrix session, so auth.ts and client.ts (which can't import each other
// without a cycle) both clear exactly the same set.
export const SESSION_KEY = "matrix_session";
export const RECOVERY_KEY = "matrix_recovery_key";
export const LOGIN_PASSWORD_KEY = "matrix_login_password";
export const LAST_USERNAME_KEY = "matrix_last_username";

// Session data lives in localStorage so a login survives closing the tab or
// browser, not just a same-tab reload. matrix_login_password stays in
// sessionStorage — it's only needed for the one-time cross-signing bootstrap
// right after login, so there's no reason for it to outlive the tab.
export function clearMatrixStorage(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(RECOVERY_KEY);
  sessionStorage.removeItem(LOGIN_PASSWORD_KEY);
}
