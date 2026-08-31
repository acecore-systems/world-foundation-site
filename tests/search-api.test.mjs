import assert from "node:assert/strict";
import { test } from "node:test";

import { onRequestPost } from "../functions/api/search.ts";

const SITE_ORIGIN = "https://world-foundation-site.pages.dev";
const CLIENT_ID = "018f7e5a-7b4d-7c6a-8e9f-0123456789ab";
const queryVector = Array.from({ length: 1024 }, () => 0.01);

test("同一originのJSON検索をlocale namespaceで実行し、安全な上位5件だけ返す", async () => {
  let aiRequest;
  let queryOptions;
  const env = createEnv({
    matches: [
      searchMatch("one", 0.81, "/docs/../docs/00-vision/", "ja"),
      searchMatch("duplicate-url", 0.79, "/docs/00-vision/", "ja"),
      searchMatch("query-url", 0.78, "/docs/01-principles/?from=search", "ja"),
      searchMatch("hash-url", 0.77, "/docs/02-architecture/#section", "ja"),
      searchMatch("api-url", 0.76, "/api/private/", "ja"),
      searchMatch("admin-url", 0.758, "/admin/private/", "ja"),
      searchMatch(
        "encoded-api-url",
        0.755,
        "/%252e%252e%252fapi/private/",
        "ja",
      ),
      searchMatch(
        "nfkc-admin-url",
        0.753,
        "/%EF%BC%85%36%31dmin/private/",
        "ja",
      ),
      searchMatch("nfkc-api-url", 0.752, "/%EF%BC%85%36%31pi/private/", "ja"),
      searchMatch("backslash-url", 0.751, "/safe\\private/", "ja"),
      searchMatch("encoded-slash-url", 0.7508, "/safe%252fprivate/", "ja"),
      searchMatch("tab-url", 0.7505, "\t/docs/00-vision/", "ja"),
      searchMatch("control-url", 0.7501, "/safe/\u0001private/", "ja"),
      searchMatch("cross-origin", 0.75, "https://example.com/docs/", "ja"),
      searchMatch("wrong-locale", 0.74, "/en/docs/00-vision/", "en"),
      searchMatch("two", 0.73, "/docs/01-principles/", "ja"),
      searchMatch("three", 0.72, "/docs/02-architecture/", "ja"),
      searchMatch("four", 0.71, "/docs/03-roadmap/", "ja"),
      searchMatch("five", 0.7, "/docs/04-non-goals/", "ja"),
      searchMatch("six", 0.69, "/docs/05-threat-model/", "ja"),
      searchMatch("too-low", 0.39, "/research/", "ja"),
    ],
    searchMinScore: undefined,
    onAiRequest(request) {
      aiRequest = request;
    },
    onQuery(_values, options) {
      queryOptions = options;
    },
  });

  const response = await onRequestPost({
    request: searchRequest({
      query: "  世界の   協力モデル  ",
      locale: "JA",
    }),
    env,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(
    response.headers.get("Cross-Origin-Resource-Policy"),
    "same-origin",
  );
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Server-Timing"), /^search;dur=/);
  assert.equal(body.ok, true);
  assert.equal(body.results.length, 5);
  assert.deepEqual(
    body.results.map(({ id, url, rank }) => ({ id, url, rank })),
    [
      { id: "duplicate-url", url: "/docs/00-vision/", rank: 1 },
      { id: "two", url: "/docs/01-principles/", rank: 2 },
      { id: "three", url: "/docs/02-architecture/", rank: 3 },
      { id: "four", url: "/docs/03-roadmap/", rank: 4 },
      { id: "five", url: "/docs/04-non-goals/", rank: 5 },
    ],
  );
  assert.deepEqual(aiRequest, {
    model: "@cf/baai/bge-m3",
    input: {
      text: ["世界の 協力モデル"],
      truncate_inputs: false,
    },
  });
  assert.deepEqual(queryOptions, {
    namespace: "ja",
    topK: 15,
    returnMetadata: "all",
    returnValues: false,
  });
});

test("英語localeと設定したscore thresholdを適用する", async () => {
  const env = createEnv({
    searchMinScore: "0.65",
    matches: [
      searchMatch("below", 0.64, "/en/docs/00-vision/", "en"),
      searchMatch("at-threshold", 0.65, "/en/docs/01-principles/", "en"),
    ],
  });

  const response = await onRequestPost({
    request: searchRequest({ query: "shared governance", locale: "en" }),
    env,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.results.map(({ id }) => id),
    ["at-threshold"],
  );
});

test("Originなし・別OriginのrequestをWorkers AIの前で403にする", async () => {
  let aiCalls = 0;
  const env = createEnv({
    onAiRequest() {
      aiCalls += 1;
    },
  });
  const noOrigin = new Request(`${SITE_ORIGIN}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "検索", locale: "ja" }),
  });
  const crossOrigin = searchRequest(
    { query: "検索", locale: "ja" },
    { Origin: "https://example.com" },
  );

  await assertError(
    onRequestPost({ request: noOrigin, env }),
    403,
    "forbidden",
  );
  await assertError(
    onRequestPost({ request: crossOrigin, env }),
    403,
    "forbidden",
  );
  assert.equal(aiCalls, 0);
});

test("application/json以外を415にし、無効化・binding不足を503にする", async () => {
  const invalidType = searchRequest(
    { query: "検索", locale: "ja" },
    { "Content-Type": "application/jsonp" },
  );
  await assertError(
    onRequestPost({ request: invalidType, env: createEnv() }),
    415,
    "unsupported_media_type",
  );

  const disabledEnv = createEnv();
  disabledEnv.SEARCH_ENABLED = "false";
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "検索", locale: "ja" }),
      env: disabledEnv,
    }),
    503,
    "unavailable",
  );

  const missingBindingEnv = createEnv();
  delete missingBindingEnv.SEARCH_INDEX;
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "検索", locale: "ja" }),
      env: missingBindingEnv,
    }),
    503,
    "unavailable",
  );

  const missingAiBindingEnv = createEnv();
  delete missingAiBindingEnv.AI;
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "検索", locale: "ja" }),
      env: missingAiBindingEnv,
    }),
    503,
    "unavailable",
  );

  const staleEmbeddingContractEnv = createEnv();
  staleEmbeddingContractEnv.SEARCH_EMBEDDING_DIMENSIONS = "1536";
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "検索", locale: "ja" }),
      env: staleEmbeddingContractEnv,
    }),
    503,
    "unavailable",
  );
});

test("不正JSON、object以外、query長、未対応localeを400にする", async () => {
  const invalidJson = new Request(`${SITE_ORIGIN}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Origin: SITE_ORIGIN,
    },
    body: "{",
  });
  await assertError(
    onRequestPost({ request: invalidJson, env: createEnv() }),
    400,
    "invalid_json",
  );

  for (const body of [
    null,
    "search",
    { query: "a", locale: "ja" },
    { query: "a".repeat(161), locale: "en" },
    { query: "search", locale: "fr" },
    { query: "\ud800x", locale: "ja" },
  ]) {
    await assertError(
      onRequestPost({ request: searchRequest(body), env: createEnv() }),
      400,
      "invalid_request",
    );
  }
});

test("検証できないrequestはD1 rate-limit枠を消費しない", async () => {
  let cleanupCount = 0;
  const consumed = [];
  const env = createEnv({
    onCleanup() {
      cleanupCount += 1;
    },
    onRateLimit(entry) {
      consumed.push(entry);
    },
  });
  const invalidJson = new Request(`${SITE_ORIGIN}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SITE_ORIGIN,
    },
    body: "{",
  });

  await assertError(
    onRequestPost({ request: invalidJson, env }),
    400,
    "invalid_json",
  );
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "search", locale: "fr" }),
      env,
    }),
    400,
    "invalid_request",
  );
  await assertError(
    onRequestPost({
      request: new Request(`${SITE_ORIGIN}/api/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "2049",
          Origin: SITE_ORIGIN,
        },
        body: JSON.stringify({ query: "検索", locale: "ja" }),
      }),
      env,
    }),
    413,
    "request_too_large",
  );

  assert.equal(cleanupCount, 0);
  assert.deepEqual(consumed, []);
});

test("Content-Lengthが2KiBを超えるbodyを読み込まず413にする", async () => {
  const request = new Request(`${SITE_ORIGIN}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "2049",
      Origin: SITE_ORIGIN,
    },
    body: JSON.stringify({ query: "検索", locale: "ja" }),
  });

  await assertError(
    onRequestPost({ request, env: createEnv() }),
    413,
    "request_too_large",
  );
  assert.equal(request.bodyUsed, false);
});

test("Content-Lengthがなくても2KiBを超えた時点でstreamを止める", async () => {
  let pulls = 0;
  const chunk = new Uint8Array(1024);
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
      if (pulls >= 10) controller.close();
    },
  });
  const request = new Request(`${SITE_ORIGIN}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SITE_ORIGIN,
    },
    body,
    duplex: "half",
  });

  await assertError(
    onRequestPost({ request, env: createEnv() }),
    413,
    "request_too_large",
  );
  assert.ok(pulls <= 4);
});

test("global 300/minを先に、client 20/minを次にD1へ渡す", async () => {
  const consumed = [];
  const cleanups = [];
  const env = createEnv({
    clientRateLimitSuccess: false,
    onCleanup(entry) {
      cleanups.push(entry);
    },
    onRateLimit(entry) {
      consumed.push(entry);
    },
  });

  const responsePromise = onRequestPost({
    request: searchRequest({ query: "協力モデル", locale: "ja" }),
    env,
  });
  await assertError(responsePromise, 429, "rate_limited", {
    "Retry-After": "60",
  });

  assert.equal(consumed.length, 2);
  assert.equal(cleanups.length, 1);
  assert.equal(cleanups[0].limit, 100);
  assert.equal(Number.isInteger(cleanups[0].now), true);
  assert.equal(consumed[0].key, "global");
  assert.equal(consumed[0].limit, 300);
  assert.match(consumed[1].key, /^client:[0-9a-f]{64}$/);
  assert.equal(consumed[1].limit, 20);
});

test("接続IPをrate-limit keyへ使わず、session UUIDだけをhashする", async () => {
  const firstKeys = [];
  const ipRequest = searchRequest({ query: "協力モデル", locale: "ja" });
  ipRequest.headers.set("CF-Connecting-IP", "203.0.113.9");
  await onRequestPost({
    request: ipRequest,
    env: createEnv({
      onRateLimit({ key }) {
        if (key !== "global") firstKeys.push(key);
      },
    }),
  });

  const secondKeys = [];
  const secondRequest = searchRequest({ query: "協力モデル", locale: "ja" });
  secondRequest.headers.set("CF-Connecting-IP", "198.51.100.4");
  await onRequestPost({
    request: secondRequest,
    env: createEnv({
      onRateLimit({ key }) {
        if (key !== "global") secondKeys.push(key);
      },
    }),
  });

  assert.equal(firstKeys.length, 1);
  assert.equal(secondKeys.length, 1);
  assert.match(firstKeys[0], /^client:[0-9a-f]{64}$/);
  assert.equal(firstKeys[0], secondKeys[0]);
  assert.doesNotMatch(firstKeys[0], /203\.0\.113\.9|198\.51\.100\.4/);
});

test("global拒否後はcleanupもcaller別row作成もせず、D1障害はfail closedにする", async () => {
  const globalEntries = [];
  let cleanupCount = 0;
  const globalEnv = createEnv({
    globalRateLimitSuccess: false,
    onCleanup() {
      cleanupCount += 1;
    },
    onRateLimit(entry) {
      globalEntries.push(entry);
    },
  });
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "協力モデル", locale: "ja" }),
      env: globalEnv,
    }),
    429,
    "rate_limited",
  );
  assert.deepEqual(globalEntries, [{ key: "global", limit: 300 }]);
  assert.equal(cleanupCount, 0);

  const storageEnv = createEnv({ rateLimitError: new Error("D1 down") });
  await assertError(
    onRequestPost({
      request: searchRequest({ query: "協力モデル", locale: "ja" }),
      env: storageEnv,
    }),
    503,
    "unavailable",
  );
});

test("Workers AI実行中のrequest中止後はVectorize queryを実行しない", async () => {
  const controller = new AbortController();
  let aiCalled = false;
  let vectorCalls = 0;
  const env = createEnv({
    onAiRequest() {
      aiCalled = true;
      controller.abort();
    },
    onQuery() {
      vectorCalls += 1;
    },
  });
  const request = searchRequest(
    { query: "協力モデル", locale: "ja" },
    {},
    controller.signal,
  );

  await assertError(onRequestPost({ request, env }), 499, "request_cancelled");
  assert.equal(aiCalled, true);
  assert.equal(request.signal.aborted, true);
  assert.equal(vectorCalls, 0);
});

test("embedding・Vectorizeの障害と不正responseを502にし、query本文をlogしない", async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (value) => logs.push(String(value));

  try {
    const invalidEmbeddingEnv = createEnv({ embedding: [0.1] });
    await assertError(
      onRequestPost({
        request: searchRequest({
          query: "秘密を含む検索テキスト",
          locale: "ja",
        }),
        env: invalidEmbeddingEnv,
      }),
      502,
      "provider_error",
    );

    const wrongContractEnv = createEnv({
      aiPayload: {
        data: [queryVector],
        shape: [1, 1024],
        pooling: "mean",
      },
    });
    await assertError(
      onRequestPost({
        request: searchRequest({
          query: "modelが違う秘密の検索テキスト",
          locale: "ja",
        }),
        env: wrongContractEnv,
      }),
      502,
      "provider_error",
    );

    const vectorErrorEnv = createEnv({
      vectorError: new Error("provider failed"),
    });
    await assertError(
      onRequestPost({
        request: searchRequest({
          query: "別の秘密を含む検索テキスト",
          locale: "ja",
        }),
        env: vectorErrorEnv,
      }),
      502,
      "provider_error",
    );

    const invalidMatchesEnv = createEnv({ queryResult: { count: 1 } });
    await assertError(
      onRequestPost({
        request: searchRequest({
          query: "三つ目の秘密を含む検索テキスト",
          locale: "ja",
        }),
        env: invalidMatchesEnv,
      }),
      502,
      "provider_error",
    );

    assert.ok(logs.length >= 4);
    for (const log of logs) {
      assert.doesNotMatch(log, /秘密/u);
    }
  } finally {
    console.error = originalError;
  }
});

function searchMatch(id, score, url, locale) {
  return {
    id,
    score,
    metadata: {
      url,
      title: `Title ${id}`,
      section: `Section ${id}`,
      excerpt: `Excerpt ${id}`,
      contentType: "doc",
      locale,
    },
  };
}

function searchRequest(body, headers = {}, signal) {
  return new Request(`${SITE_ORIGIN}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Origin: SITE_ORIGIN,
      "X-World-Foundation-Search-Client": CLIENT_ID,
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
}

function createEnv({
  matches = [],
  queryResult,
  embedding = queryVector,
  searchMinScore = "0.40",
  clientRateLimitSuccess = true,
  globalRateLimitSuccess = true,
  rateLimitError,
  vectorError,
  aiError,
  aiPayload,
  onAiRequest = () => {},
  onQuery = () => {},
  onCleanup = () => {},
  onRateLimit = () => {},
} = {}) {
  return {
    AI: {
      async run(model, input) {
        onAiRequest({ model, input });
        if (aiError) throw aiError;
        return (
          aiPayload ?? {
            data: [embedding],
            shape: [1, 1024],
            pooling: "cls",
          }
        );
      },
    },
    SEARCH_EMBEDDING_MODEL: "@cf/baai/bge-m3",
    SEARCH_EMBEDDING_DIMENSIONS: "1024",
    SEARCH_ENABLED: "true",
    SEARCH_MIN_SCORE: searchMinScore,
    SEARCH_RATE_LIMIT_DB: createRateLimitDatabase({
      clientRateLimitSuccess,
      globalRateLimitSuccess,
      rateLimitError,
      onCleanup,
      onRateLimit,
    }),
    SEARCH_INDEX: {
      async query(values, options) {
        if (vectorError) throw vectorError;
        assert.equal(values.length, 1024);
        onQuery(values, options);
        return queryResult ?? { count: matches.length, matches };
      },
    },
  };
}

function createRateLimitDatabase({
  clientRateLimitSuccess,
  globalRateLimitSuccess,
  rateLimitError,
  onCleanup,
  onRateLimit,
}) {
  return {
    prepare(query) {
      if (rateLimitError) throw rateLimitError;

      if (query.startsWith("DELETE")) {
        assert.match(query, /LIMIT \?2/);
        assert.match(query, /SELECT limiter_key, window_start/);
        assert.doesNotMatch(query, /\browid\b/);
        return {
          bind(now, limit) {
            return {
              async run() {
                onCleanup({ now, limit });
                return { success: true };
              },
            };
          },
        };
      }

      assert.match(query, /INSERT INTO semantic_search_rate_limits/);
      return {
        bind(key, _windowStart, _expiresAt, limit) {
          return {
            async first() {
              onRateLimit({ key, limit });
              const success =
                key === "global"
                  ? globalRateLimitSuccess
                  : clientRateLimitSuccess;
              return success ? { request_count: 1 } : null;
            },
          };
        },
      };
    },
  };
}

async function assertError(
  responsePromise,
  status,
  code,
  expectedHeaders = {},
) {
  const response = await responsePromise;
  const body = await response.json();

  assert.equal(response.status, status);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.ok(body.requestId);
  for (const [name, value] of Object.entries(expectedHeaders)) {
    assert.equal(response.headers.get(name), value);
  }
}
