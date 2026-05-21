"use client";

import useSWR, { mutate as globalMutate } from "swr";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export function useResource<T>(key: string | null) {
  return useSWR<T>(key, fetcher);
}

export function invalidate(key: string | RegExp) {
  if (typeof key === "string") return globalMutate(key);
  return globalMutate((k) => typeof k === "string" && key.test(k));
}
