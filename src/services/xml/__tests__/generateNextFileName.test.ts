import { describe, it, expect } from "vitest";
import { generateNextFileName } from "@/services/xml/serialize";

describe("generateNextFileName — version increment", () => {
  it("appends _v1 when no version is present", () => {
    expect(generateNextFileName("model.xml")).toBe("model_v1.xml");
  });

  it("increments single-digit version", () => {
    expect(generateNextFileName("model_v1.xml")).toBe("model_v2.xml");
    expect(generateNextFileName("model_v2.xml")).toBe("model_v3.xml");
  });

  it("rolls single-digit to double-digit", () => {
    expect(generateNextFileName("model_v9.xml")).toBe("model_v10.xml");
  });

  it("increments multi-digit version", () => {
    expect(generateNextFileName("model_v10.xml")).toBe("model_v11.xml");
    expect(generateNextFileName("customer_data_v10.xml")).toBe("customer_data_v11.xml");
    expect(generateNextFileName("model_v999.xml")).toBe("model_v1000.xml");
  });
});

describe("generateNextFileName — case sensitivity", () => {
  it("preserves the case of the _v / _V marker", () => {
    expect(generateNextFileName("model_V1.xml")).toBe("model_V2.xml");
    expect(generateNextFileName("MODEL_V9.XML")).toBe("MODEL_V10.xml");
  });
});

describe("generateNextFileName — extension handling", () => {
  it("appends .xml when no extension is present", () => {
    expect(generateNextFileName("model")).toBe("model_v1.xml");
    expect(generateNextFileName("model_v3")).toBe("model_v4.xml");
  });

  it("normalizes non-.xml extensions to .xml", () => {
    expect(generateNextFileName("model.txt")).toBe("model_v1.xml");
  });
});

describe("generateNextFileName — multiple _v occurrences", () => {
  it("increments only the trailing _v group", () => {
    expect(generateNextFileName("model_v2_v3.xml")).toBe("model_v2_v4.xml");
    expect(generateNextFileName("v1_model_v5.xml")).toBe("v1_model_v6.xml");
  });

  it("treats a non-trailing _v<n> as part of the base name", () => {
    expect(generateNextFileName("customer_v1_data.xml")).toBe("customer_v1_data_v1.xml");
  });
});

describe("generateNextFileName — v-padded pattern", () => {
  it("zero-pads the initial version to width 2", () => {
    expect(generateNextFileName("model.xml", "v-padded")).toBe("model_v01.xml");
  });

  it("preserves explicit padding width on increment", () => {
    expect(generateNextFileName("model_v01.xml", "v-padded")).toBe("model_v02.xml");
    expect(generateNextFileName("model_v003.xml", "v-padded")).toBe("model_v004.xml");
  });

  it("grows past the padded width when the number outgrows it", () => {
    expect(generateNextFileName("model_v99.xml", "v-padded")).toBe("model_v100.xml");
  });
});

describe("generateNextFileName — timestamp pattern", () => {
  it("appends an ISO date stamp", () => {
    const r = generateNextFileName("model.xml", "timestamp");
    expect(r).toMatch(/^model_\d{4}-\d{2}-\d{2}\.xml$/);
  });

  it("strips a prior _v<n> suffix instead of stacking", () => {
    const r = generateNextFileName("model_v3.xml", "timestamp");
    expect(r).toMatch(/^model_\d{4}-\d{2}-\d{2}\.xml$/);
    expect(r).not.toMatch(/_v3/);
  });

  it("strips a prior date suffix instead of stacking", () => {
    const r = generateNextFileName("model_2024-01-15.xml", "timestamp");
    expect(r).toMatch(/^model_\d{4}-\d{2}-\d{2}\.xml$/);
    expect(r.match(/\d{4}-\d{2}-\d{2}/g)?.length).toBe(1);
  });
});

describe("generateNextFileName — edge cases", () => {
  it("preserves spaces in the base name", () => {
    expect(generateNextFileName("customer data.xml")).toBe("customer data_v1.xml");
    expect(generateNextFileName("customer data_v2.xml")).toBe("customer data_v3.xml");
  });

  it("falls back to untitled for empty / whitespace input", () => {
    expect(generateNextFileName("")).toBe("untitled_v1.xml");
    expect(generateNextFileName("   ")).toBe("untitled_v1.xml");
  });

  it("treats malformed _v patterns as no-version", () => {
    expect(generateNextFileName("model_v.xml")).toBe("model_v_v1.xml");
    expect(generateNextFileName("model_vx.xml")).toBe("model_vx_v1.xml");
  });
});
