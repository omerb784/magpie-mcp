let baseUrl: string | null = null;

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, "");
}

export function getBaseUrl(): string {
  return baseUrl ?? "http://127.0.0.1:3737";
}
