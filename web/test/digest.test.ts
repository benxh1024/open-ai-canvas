import { describe, expect, test } from "bun:test";

import { sha256Hex } from "@/lib/digest";

const ABC_SHA_256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("SHA-256 digest compatibility", () => {
    test("uses a deterministic equivalent when Web Crypto is unavailable", async () => {
        const longInput = "generated-media:".repeat(64);
        const nativeDigest = await sha256Hex(longInput);
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
        try {
            expect(await sha256Hex("abc")).toBe(ABC_SHA_256);
            expect(await sha256Hex(longInput)).toBe(nativeDigest);
            expect(await sha256Hex("generation-result")).toBe(await sha256Hex("generation-result"));
        } finally {
            if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
            else Reflect.deleteProperty(globalThis, "crypto");
        }
    });

    test("matches Web Crypto output when the browser implementation is available", async () => {
        expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(ABC_SHA_256);
    });
});
