import { useCallback, useEffect, useState } from 'react'

export interface Route {
  path: string
  params: URLSearchParams
}

function read(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  return { path: path || '/', params: new URLSearchParams(query) }
}

/** Tiny hash router: works on GitHub Pages subpaths and offline without server rewrites. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function useNavigate() {
  return useCallback((to: string) => {
    window.location.hash = to
  }, [])
}

export function href(to: string): string {
  return `#${to}`
}
