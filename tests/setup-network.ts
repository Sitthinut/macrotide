// Unit tests never reach the network: a live call ties a test to a third
// party's uptime, so a slow upstream turns into test timeouts. The default
// fetch fails fast with the URL; a test that needs a response stubs fetch
// itself (vi.stubGlobal / vi.spyOn), which replaces this guard for that test.
const blockedFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(
    `Live network call in a unit test: ${url.split("?")[0]}. Stub fetch in this test.`,
  );
};

globalThis.fetch = blockedFetch;
