const HOMESERVER_STORAGE_KEY = "matrix_homeserver_url";
const DEFAULT_HOMESERVER = "https://matrix.org";

export function getHomeserverUrl(): string {
  return localStorage.getItem(HOMESERVER_STORAGE_KEY) ?? DEFAULT_HOMESERVER;
}

export function setHomeserverUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, "");
  if (trimmed) {
    localStorage.setItem(HOMESERVER_STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(HOMESERVER_STORAGE_KEY);
  }
}

export const APP_PREFIX = "demo-e2e-app";

export const EVENT_TYPE_CONTACT_UPDATE = "org.demo-e2e-app.contact.update";
export const EVENT_TYPE_COMMENT = "org.demo-e2e-app.contact.comment";

export const roomDataName = (contactId: string) =>
  `${APP_PREFIX}/channels/${contactId}`;

export const roomCommentsName = (contactId: string) =>
  `${APP_PREFIX}/channels/${contactId}-comments`;
