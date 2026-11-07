import { it, expect, vi } from "vitest";
import { ObservationCapture } from "../../src/observations/capture.js";
import { journeySchema } from "../../src/config/schema.js";
it("keeps the serialized observation document within its exact byte budget across event sizes and timestamp widths", () => {
  const now = vi.spyOn(Date, "now");
  try {
    const flow = journeySchema.parse({
      schemaVersion: 1,
      name: "limit",
      observations: { maxBytes: 16384, maxEvents: 1000 },
      steps: Array.from({ length: 100 }, (_, i) => ({
        id: `s${i}`,
        action: "goto",
        path: "/" + "x/".repeat(200),
      })),
    });
    for (const time of [0, 9, 99, 999, 9999])
      for (let length = 190; length <= 210; length++) {
        now.mockReturnValue(time);
        const capture = new ObservationCapture(
          flow,
          "1793730000000-abcd1234",
          "http://127.0.0.1",
          [],
          0,
        );
        for (let n = 0; n < 100; n++)
          capture.popup("page-2", "http://127.0.0.1/" + "a/".repeat(length));
        expect(capture.document.truncated).toBe(true);
        expect(
          Buffer.byteLength(JSON.stringify(capture.document)),
        ).toBeLessThanOrEqual(16384);
      }
  } finally {
    now.mockRestore();
  }
});
