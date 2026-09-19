import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const storageData = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storageData.size;
  },
  clear() {
    storageData.clear();
  },
  getItem(key) {
    return storageData.get(key) ?? null;
  },
  key(index) {
    return [...storageData.keys()][index] ?? null;
  },
  removeItem(key) {
    storageData.delete(key);
  },
  setItem(key, value) {
    storageData.set(key, String(value));
  },
};

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

afterEach(() => {
  cleanup();
  localStorageMock.clear();
});
