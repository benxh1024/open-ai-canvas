import { expect, test } from "bun:test";

import { getAuthSession, invalidateAuthSessionCache } from "../src/services/api/auth";
import { apiClient } from "../src/services/api/request";

test("auth session bootstrap uses a bounded request", async () => {
    const originalRequest = apiClient.request;
    const requests: Array<Record<string, unknown>> = [];
    apiClient.request = (async (config: Record<string, unknown>) => {
        requests.push(config);
        return { data: { code: 0, data: { user: null }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;

    try {
        invalidateAuthSessionCache();
        await getAuthSession();
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ method: "get", url: "/auth/session", timeout: 8_000 });
    } finally {
        invalidateAuthSessionCache();
        apiClient.request = originalRequest;
    }
});
