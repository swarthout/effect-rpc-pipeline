import { Schema } from "effect"
import { defineRouteUnion } from "foldkit/route"
import type { Url } from "foldkit/url"
import { base, pages } from "./content"

export const AppRoute = defineRouteUnion({
  Home: {},
  Page: { slug: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const routeForPath = (pathname: string): AppRoute => {
  if (!pathname.startsWith(base)) {
    return AppRoute.NotFound({ path: pathname })
  }
  const slug = pathname.slice(base.length).replace(/\/$/, "")
  if (slug === "" || slug === "index.html") {
    return AppRoute.Home()
  }
  if (pages.some((page) => page.slug === slug)) {
    return AppRoute.Page({ slug })
  }
  return AppRoute.NotFound({ path: pathname })
}
export const urlToAppRoute = (url: Url) => routeForPath(url.pathname)
