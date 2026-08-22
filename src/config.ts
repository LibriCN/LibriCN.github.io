function normalizePath(value: string) {
  const path = value.trim().replace(/^\/+|\/+$/g, '')
  return `/${path || 'admin'}`
}

export const appConfig = {
  cityName: import.meta.env.VITE_CITY_NAME || 'Sua cidade',
  citySymbol: import.meta.env.VITE_CITY_SYMBOL || '✦',
  apiUrl: (import.meta.env.VITE_API_URL || '').replace(/\/$/, ''),
  basePath: (import.meta.env.VITE_BASE_PATH || '/').replace(/\/$/, '') || '/',
  adminPath: normalizePath(import.meta.env.VITE_ADMIN_PATH || '/admin'),
}

export function adminUrl(path = '') { return `${appConfig.adminPath}${path}` }
