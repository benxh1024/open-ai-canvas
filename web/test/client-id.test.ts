import { describe, expect, test } from "bun:test";

import { createClientId, createClientUUID } from "../src/lib/client-id";

describe("createClientId", () => {
    test("生成不依赖 randomUUID 的唯一客户端标识", () => {
        const ids = Array.from({ length: 100 }, () => createClientId());

        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/));
    });
});

describe("createClientUUID", () => {
    test("生成 UUID v4 格式的唯一客户端标识", () => {
        const ids = Array.from({ length: 100 }, () => createClientUUID());

        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    });
});
