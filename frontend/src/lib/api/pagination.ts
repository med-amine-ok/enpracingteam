type Page<T> = { results: T[]; next?: string | null };

/**
 * Every item of a paginated API list (PAGE_SIZE = 50 in backend/config/settings.py), page after page.
 * For small lists only (members, org units): a list that grows past `maxPages` needs API filters.
 */
export async function fetchAllPages<T>(fetchPage: (page: number) => Promise<Page<T>>, maxPages = 20) {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { results, next } = await fetchPage(page);
    items.push(...results);
    if (!next) {
      return items;
    }
  }
  throw new Error(`More than ${maxPages} pages: filter on the API side instead of loading everything.`);
}
