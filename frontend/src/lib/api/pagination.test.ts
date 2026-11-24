import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "./pagination";

describe("fetchAllPages", () => {
  it("follows the pages until the last one", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      results: [page * 10, page * 10 + 1],
      next: page < 3 ? `http://localhost:8000/api/members/?page=${page + 1}` : null,
    }));
    expect(await fetchAllPages(fetchPage)).toEqual([10, 11, 20, 21, 30, 31]);
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("stops instead of loading an endless list", async () => {
    const fetchPage = vi.fn(async () => ({ results: [1], next: "more" }));
    await expect(fetchAllPages(fetchPage, 3)).rejects.toThrow("More than 3 pages");
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
