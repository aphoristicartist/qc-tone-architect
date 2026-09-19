import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { parseModelRepo, QCModelCatalogError } from "./model-catalog";

const XML = `<?xml version="1.0"?>
<Models>
  <Category id="1" name="Guitar Amplifier">
    <Model id="1001" name="Brit 2203 Legacy" tm="Marshall JCM800" hidden="true">
      <Parameter name="GAIN" min="0" max="10" defaultValue="5" units="" type="knob" />
    </Model>
    <Model id="1002" name="Brit 2203" tm="Marshall JCM800" replaces="1001">
      <Parameter name="GAIN" min="0" max="10" defaultValue="5" units="" type="knob" />
      <Parameter name="MODE" min="0" max="1" steps="3" stepNames="Clean, Crunch, Lead" type="comboBox" />
    </Model>
  </Category>
  <Category id="12" name="Cabsim Guitar (M)">
    <Model id="12001" name="4x12 CA V30 (M)" tm="Mesa Rectifier Cabinet">
      <Parameter name="LEVEL" min="MIN_CABSIM_DB" max="MAX_CABSIM_DB" skew="4.9594844" />
      <Parameter name="LEVEL" min="MIN_CABSIM_DB" max="MAX_CABSIM_DB" skew="4.9594844" />
    </Model>
  </Category>
</Models>`;

function tarXml(xml: string): Buffer {
  const body = Buffer.from(xml);
  const header = Buffer.alloc(512);
  header.write("ModelRepo.xml", 0, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(`${body.byteLength.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  const padding = Buffer.alloc(Math.ceil(body.byteLength / 512) * 512 - body.byteLength);
  return Buffer.concat([header, body, padding, Buffer.alloc(1_024)]);
}

describe("Quad Cortex live model catalog", () => {
  it.each([
    Buffer.from(XML),
    tarXml(XML),
    gzipSync(tarXml(XML)),
  ])("parses bare, tarred, and device-shaped catalog payloads", (payload) => {
    const catalog = parseModelRepo(payload);

    expect(catalog.models).toHaveLength(3);
    expect(catalog.get(1002)).toMatchObject({
      name: "Brit 2203",
      category: "Guitar Amplifier",
      superseded: false,
      parameters: [
        { index: 0, name: "GAIN" },
        {
          index: 1,
          name: "MODE",
          options: ["Clean", "Crunch", "Lead"],
        },
      ],
    });
    expect(catalog.get(1001)?.superseded).toBe(true);
  });

  it("resolves only unique active models and parameters", () => {
    const catalog = parseModelRepo(Buffer.from(XML));
    const amp = catalog.resolveModel({ name: "brit-2203" });

    expect(amp.id).toBe(1002);
    expect(catalog.resolveParameter(amp, "gain").index).toBe(0);
    expect(() =>
      catalog.resolveParameter(catalog.get(12001)!, "level"),
    ).toThrow("multiple parameters");
  });

  it("refuses ambiguous origin matching instead of guessing a channel", () => {
    const ambiguous = XML.replace(
      "</Category>",
      '<Model id="1003" name="Brit 2203 Bright" tm="Marshall JCM800" /></Category>',
    );
    const catalog = parseModelRepo(Buffer.from(ambiguous));

    expect(() =>
      catalog.resolveModel({ name: "unknown alias", basedOn: "Marshall JCM800" }),
    ).toThrow("maps to multiple QC models");
  });

  it.each([
    Buffer.from("not a tar"),
    Buffer.from("<!DOCTYPE Models><Models />"),
    Buffer.from("<Models><Category></Models>"),
  ])("rejects malformed or unsafe catalog data", (payload) => {
    expect(() => parseModelRepo(payload)).toThrow(QCModelCatalogError);
  });
});
