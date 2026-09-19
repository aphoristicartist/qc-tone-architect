import { gunzipSync } from "node:zlib";

import { XMLParser, XMLValidator } from "fast-xml-parser";

const TAR_BLOCK_SIZE = 512;
const MAX_CONTAINER_SIZE = 4 * 1024 * 1024;
const MAX_XML_SIZE = 2 * 1024 * 1024;
const MAX_CATEGORIES = 128;
const MAX_MODELS = 2_048;
const MAX_PARAMETERS_PER_MODEL = 256;

export class QCModelCatalogError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QCModelCatalogError";
  }
}

export interface QCModelParameter {
  index: number;
  name: string;
  minimum?: number;
  maximum?: number;
  minimumToken?: string;
  maximumToken?: string;
  defaultValue?: number;
  units: string;
  type: string;
  steps?: number;
  skew: number;
  options: readonly string[];
  dynamic: boolean;
}

export interface QCModel {
  id: number;
  name: string;
  categoryId: number;
  category: string;
  basedOn: string;
  parameters: readonly QCModelParameter[];
  replaces: readonly number[];
  superseded: boolean;
  hidden: boolean;
}

export interface QCModelQuery {
  name: string;
  basedOn?: string;
}

type XmlNode = Record<string, unknown> & { $?: Record<string, unknown> };

function normalizeLookup(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readString(buffer: Buffer, start: number, length: number): string {
  const field = buffer.subarray(start, start + length);
  const terminator = field.indexOf(0);
  return field
    .subarray(0, terminator === -1 ? field.byteLength : terminator)
    .toString("utf8")
    .trim();
}

function readTarNumber(buffer: Buffer, start: number, length: number): number {
  const text = readString(buffer, start, length).trim();
  if (!/^[0-7]+$/.test(text)) {
    throw new QCModelCatalogError("ModelRepo tar contains an invalid number");
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new QCModelCatalogError("ModelRepo tar number is out of range");
  }
  return value;
}

function validTarChecksum(header: Buffer): boolean {
  const expected = readTarNumber(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return actual === expected;
}

function extractXmlFromTar(container: Buffer): Buffer {
  for (let offset = 0; offset + TAR_BLOCK_SIZE <= container.byteLength; ) {
    const header = container.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break;
    if (!validTarChecksum(header)) {
      throw new QCModelCatalogError("ModelRepo tar checksum is invalid");
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = readTarNumber(header, 124, 12);
    const type = header[156];
    const bodyOffset = offset + TAR_BLOCK_SIZE;
    const bodyEnd = bodyOffset + size;
    if (bodyEnd > container.byteLength) {
      throw new QCModelCatalogError("ModelRepo tar entry is truncated");
    }

    if (
      fullName.toLowerCase().endsWith(".xml") &&
      (type === 0 || type === 0x30)
    ) {
      if (size > MAX_XML_SIZE) {
        throw new QCModelCatalogError("ModelRepo XML exceeds the safety limit");
      }
      return Buffer.from(container.subarray(bodyOffset, bodyEnd));
    }

    offset =
      bodyOffset + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }
  throw new QCModelCatalogError("ModelRepo archive contains no XML catalog");
}

function extractModelRepoXml(payload: Uint8Array): Buffer {
  let container = Buffer.from(payload);
  if (container.byteLength > MAX_CONTAINER_SIZE) {
    throw new QCModelCatalogError("ModelRepo payload exceeds the safety limit");
  }
  if (container[0] === 0x1f && container[1] === 0x8b) {
    try {
      container = gunzipSync(container, {
        maxOutputLength: MAX_CONTAINER_SIZE,
      });
    } catch (error) {
      throw new QCModelCatalogError("ModelRepo gzip payload is invalid", {
        cause: error,
      });
    }
  }
  if (container.subarray(0, 256).toString("utf8").trimStart().startsWith("<")) {
    if (container.byteLength > MAX_XML_SIZE) {
      throw new QCModelCatalogError("ModelRepo XML exceeds the safety limit");
    }
    return container;
  }
  return extractXmlFromTar(container);
}

function asNodes(value: unknown): XmlNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is XmlNode =>
      typeof candidate === "object" && candidate !== null,
  );
}

function attributes(node: XmlNode): Record<string, string> {
  if (!node.$ || typeof node.$ !== "object") return {};
  return Object.fromEntries(
    Object.entries(node.$).map(([key, value]) => [key, String(value)]),
  );
}

function optionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function requiredInteger(value: string | undefined, name: string): number {
  const parsed = optionalInteger(value);
  if (parsed === undefined) {
    throw new QCModelCatalogError(`ModelRepo ${name} is not an integer`);
  }
  return parsed;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bound(value: string | undefined): {
  number?: number;
  token?: string;
} {
  if (value === undefined || !value.trim()) return {};
  const parsed = optionalNumber(value);
  return parsed === undefined ? { token: value.trim() } : { number: parsed };
}

function skew(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized || normalized === "LIN_SKEW") return 1;
  if (normalized === "LOG_SKEW") return 0.3;
  const parsed = optionalNumber(normalized);
  if (parsed === undefined || parsed <= 0) {
    throw new QCModelCatalogError(`Unsupported ModelRepo skew ${value}`);
  }
  return parsed;
}

function parseParameter(node: XmlNode, index: number): QCModelParameter {
  const attr = attributes(node);
  const minimum = bound(attr.min);
  const maximum = bound(attr.max);
  return {
    index,
    name: attr.name ?? "",
    minimum: minimum.number,
    maximum: maximum.number,
    minimumToken: minimum.token,
    maximumToken: maximum.token,
    defaultValue: optionalNumber(attr.defaultValue),
    units: attr.units ?? "",
    type: attr.type ?? "",
    steps: optionalInteger(attr.steps),
    skew: skew(attr.skew),
    options: (attr.stepNames ?? "")
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean),
    dynamic: attr.dynamic === "true",
  };
}

function parseReplaces(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => optionalInteger(item.trim()))
    .filter((item): item is number => item !== undefined);
}

export class QCModelCatalog {
  private readonly byId: ReadonlyMap<number, QCModel>;

  constructor(readonly models: readonly QCModel[]) {
    this.models = Object.freeze([...models]);
    this.byId = new Map(this.models.map((model) => [model.id, model]));
  }

  get(modelId: number): QCModel | undefined {
    return this.byId.get(modelId);
  }

  resolveModel(query: QCModelQuery): QCModel {
    const active = this.models.filter(
      (model) => !model.hidden && !model.superseded,
    );
    const exactName = active.filter(
      (model) => normalizeLookup(model.name) === normalizeLookup(query.name),
    );
    if (exactName.length === 1) return exactName[0];
    if (exactName.length > 1) {
      throw new QCModelCatalogError(
        `Model name ${JSON.stringify(query.name)} is ambiguous on this Quad Cortex`,
      );
    }

    if (query.basedOn) {
      const exactOrigin = active.filter(
        (model) =>
          normalizeLookup(model.basedOn) === normalizeLookup(query.basedOn!),
      );
      if (exactOrigin.length === 1) return exactOrigin[0];
      if (exactOrigin.length > 1) {
        throw new QCModelCatalogError(
          `${JSON.stringify(query.basedOn)} maps to multiple QC models: ${exactOrigin.map((model) => model.name).join(", ")}`,
        );
      }
    }

    throw new QCModelCatalogError(
      `No active QC model uniquely matches ${JSON.stringify(query.name)}`,
    );
  }

  resolveParameter(model: QCModel, name: string): QCModelParameter {
    const matches = model.parameters.filter(
      (parameter) =>
        normalizeLookup(parameter.name) === normalizeLookup(name),
    );
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      throw new QCModelCatalogError(
        `Model ${JSON.stringify(model.name)} has no parameter ${JSON.stringify(name)}`,
      );
    }
    throw new QCModelCatalogError(
      `Model ${JSON.stringify(model.name)} has multiple parameters named ${JSON.stringify(name)} at indexes ${matches.map((parameter) => parameter.index).join(", ")}`,
    );
  }
}

export function parseModelRepo(payload: Uint8Array): QCModelCatalog {
  const xml = extractModelRepoXml(payload);
  const source = xml.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new QCModelCatalogError("ModelRepo XML declarations are not allowed");
  }
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    throw new QCModelCatalogError("ModelRepo XML is malformed");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributesGroupName: "$",
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: false,
    isArray: (tagName) =>
      tagName === "Category" || tagName === "Model" || tagName === "Parameter",
  });
  const parsed = parser.parse(source) as { Models?: XmlNode };
  const categories = asNodes(parsed.Models?.Category);
  if (categories.length === 0 || categories.length > MAX_CATEGORIES) {
    throw new QCModelCatalogError("ModelRepo has an invalid category count");
  }

  const models: Array<Omit<QCModel, "superseded">> = [];
  for (const categoryNode of categories) {
    const category = attributes(categoryNode);
    const categoryId = requiredInteger(category.id, "category ID");
    for (const modelNode of asNodes(categoryNode.Model)) {
      if (models.length >= MAX_MODELS) {
        throw new QCModelCatalogError("ModelRepo exceeds the model safety limit");
      }
      const model = attributes(modelNode);
      const parameters = asNodes(modelNode.Parameter);
      if (parameters.length > MAX_PARAMETERS_PER_MODEL) {
        throw new QCModelCatalogError(
          `Model ${JSON.stringify(model.name)} exceeds the parameter safety limit`,
        );
      }
      models.push({
        id: requiredInteger(model.id, "model ID"),
        name: model.name ?? "",
        categoryId,
        category: category.name ?? "",
        basedOn: model.tm ?? "",
        parameters: parameters.map(parseParameter),
        replaces: parseReplaces(model.replaces),
        hidden: model.hidden !== undefined || category.hidden !== undefined,
      });
    }
  }

  const ids = new Set<number>();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new QCModelCatalogError(`Duplicate ModelRepo model ID ${model.id}`);
    }
    ids.add(model.id);
  }
  const superseded = new Set(models.flatMap((model) => model.replaces));
  return new QCModelCatalog(
    models.map((model) =>
      Object.freeze({
        ...model,
        parameters: Object.freeze(
          model.parameters.map((parameter) =>
            Object.freeze({
              ...parameter,
              options: Object.freeze([...parameter.options]),
            }),
          ),
        ),
        replaces: Object.freeze([...model.replaces]),
        superseded: superseded.has(model.id),
      }),
    ),
  );
}
