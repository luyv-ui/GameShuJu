export function apiUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
}
