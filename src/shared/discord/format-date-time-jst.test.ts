import { describe, expect, it } from "vitest";

import { formatDateTimeJst } from "./format-date-time-jst";

describe("formatDateTimeJst", () => {
  it("UTC日時をJST文字列へ変換する", () => {
    expect(formatDateTimeJst(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01 09:00:00 JST");
  });
});
