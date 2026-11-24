import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { ApiError } from "./errors";
import { refreshSession, withSessionRefresh } from "./session";

const answer = (status: number) => ({ response: new Response(null, { status }) });

describe("withSessionRefresh", () => {
  it("does not renew a valid session", async () => {
    const call = vi.fn().mockResolvedValue(answer(200));
    const refresh = vi.fn();
    expect((await withSessionRefresh(call, refresh)).response.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renews an expired access token once, then tries again", async () => {
    const call = vi.fn().mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200));
    const refresh = vi.fn().mockResolvedValue(true);
    expect((await withSessionRefresh(call, refresh)).response.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("gives up when the session itself has ended", async () => {
    const call = vi.fn().mockResolvedValue(answer(401));
    const refresh = vi.fn().mockResolvedValue(false);
    expect((await withSessionRefresh(call, refresh)).response.status).toBe(401);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("lets the failure through when the session could not be renewed (API restarting)", async () => {
    const call = vi.fn().mockResolvedValue(answer(401));
    const refresh = vi.fn().mockRejectedValue(new ApiError(503, ""));
    await expect(withSessionRefresh(call, refresh)).rejects.toMatchObject({ status: 503 });
  });
});

describe("refreshSession", () => {
  it("sends one request for calls made at the same time", async () => {
    const post = vi.spyOn(api, "POST").mockResolvedValue(answer(200) as never);
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(results).toEqual([true, true, true]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/auth/refresh/");
  });

  it("answers false only when the API refuses the session", async () => {
    for (const status of [401, 403]) {
      vi.spyOn(api, "POST").mockResolvedValue(answer(status) as never);
      expect(await refreshSession()).toBe(false);
    }
  });

  it("fails, without ending the session, when the API cannot answer", async () => {
    vi.spyOn(api, "POST").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(refreshSession()).rejects.toEqual(new ApiError(0, ""));
    for (const status of [429, 502, 503]) {
      vi.spyOn(api, "POST").mockResolvedValue(answer(status) as never);
      await expect(refreshSession()).rejects.toMatchObject({ status });
    }
  });
});

describe("withSessionRefresh across tabs (navigator.locks)", () => {
  const request = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());

  beforeEach(() => {
    request.mockClear();
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tries the call again first, as another tab may just have renewed the session", async () => {
    const call = vi.fn().mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200));
    const refresh = vi.fn();
    expect((await withSessionRefresh(call, refresh)).response.status).toBe(200);
    expect(request).toHaveBeenCalledWith("enp-auth-refresh", expect.any(Function));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renews the session inside the lock when the call is still refused", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(answer(401))
      .mockResolvedValueOnce(answer(401))
      .mockResolvedValueOnce(answer(200));
    const refresh = vi.fn().mockResolvedValue(true);
    expect((await withSessionRefresh(call, refresh)).response.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(3);
  });
});
