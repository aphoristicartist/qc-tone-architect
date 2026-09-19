import { describe, expect, it } from "vitest";

import { TEST_TONE } from "@/test/fixtures";

import {
  encodeRemoveBlock,
  findGridBlock,
  type QCGridSnapshot,
} from "./grid-messages";
import { QCConnection, discoverDevices } from "./qc-connection";
import { QCSession, QCSessionTimeoutError } from "./session";
import {
  applyToneToCurrentGrid,
  resolveToneForQC,
  type QCResolvedTone,
} from "./tone-transfer";

const HIL_CONFIRMATION = "MUTATE_AND_RESTORE_EMPTY_QC_PRESET";
const hilEnabled =
  process.env.QC_HIL_TRANSFER_CONFIRM === HIL_CONFIRMATION &&
  Boolean(process.env.QC_HIL_SERIAL?.trim());

async function removeAndVerify(
  session: QCSession,
  plan: QCResolvedTone,
): Promise<void> {
  for (const block of [...plan.blocks].reverse()) {
    const snapshot = await session.readCurrentPreset();
    const current = findGridBlock(snapshot, block.row, block.column);
    if (!current || current.modelId === 0) continue;
    if (current.modelId !== block.model.id) {
      throw new Error(
        `Cleanup refused because target ${block.row + 1}.${block.column + 1} contains a different model`,
      );
    }
    try {
      await session.applyGridMutation(
        encodeRemoveBlock(block.row, block.column),
        (echo) => {
          const removed = findGridBlock(echo, block.row, block.column);
          return removed === undefined || removed.modelId === 0;
        },
      );
    } catch (error) {
      if (!(error instanceof QCSessionTimeoutError)) throw error;
      const readback = await session.readCurrentPreset();
      const remaining = findGridBlock(readback, block.row, block.column);
      if (remaining && remaining.modelId !== 0) throw error;
    }
  }
}

async function restoreSnapshotMetadata(
  session: QCSession,
  plan: QCResolvedTone,
  before: QCGridSnapshot,
  activeScene: number,
): Promise<void> {
  for (const scene of plan.scenes) {
    await session.setSceneLabel(
      scene.index,
      before.sceneLabels[scene.index] ?? " ",
    );
  }
  await session.switchScene(activeScene);
}

describe.skipIf(!hilEnabled)("opt-in Quad Cortex hardware transaction", () => {
  it(
    "applies the complete tone, verifies it, and restores the empty test preset",
    async () => {
      const expectedSerial = process.env.QC_HIL_SERIAL!.trim();
      const devices = discoverDevices();
      const deviceWithMatchingHidSerial = devices.find(
        (candidate) => candidate.serialNumber === expectedSerial,
      );
      const device =
        deviceWithMatchingHidSerial ??
        (devices.length === 1 && !devices[0].serialNumber
          ? devices[0]
          : undefined);
      expect(
        device,
        "The explicitly named Quad Cortex must be the only connected unit or expose a matching HID serial",
      ).toBeDefined();

      const connection = new QCConnection({ allowExperimentalWrites: true });
      const session = new QCSession(connection);
      let plan: QCResolvedTone | undefined;
      let before: QCGridSnapshot | undefined;
      let activeScene: number | undefined;
      try {
        connection.connect(device!.path);
        const info = await session.start();
        expect(
          info.version.serialNumber,
          "The protocol serial must match before any grid mutation",
        ).toBe(expectedSerial);
        plan = resolveToneForQC(TEST_TONE, info.modelCatalog);
        before = await session.readCurrentPreset();
        activeScene = await session.readActiveScene();
        const occupied = plan.blocks.filter((block) => {
          const current = findGridBlock(before!, block.row, block.column);
          return current !== undefined && current.modelId !== 0;
        });
        expect(
          occupied,
          "Load an expendable preset with rows 1.1 through 1.4 empty before enabling this test",
        ).toEqual([]);

        await expect(
          applyToneToCurrentGrid(TEST_TONE, session, {
            allowUnverifiedFirmware: true,
          }),
        ).resolves.toMatchObject({ appliedBlocks: 4, configuredScenes: 2 });
      } finally {
        try {
          if (plan && before && activeScene !== undefined) {
            await removeAndVerify(session, plan);
            await restoreSnapshotMetadata(session, plan, before, activeScene);
            const restored = await session.readCurrentPreset();
            expect(
              plan.blocks.some((block) => {
                const current = findGridBlock(
                  restored,
                  block.row,
                  block.column,
                );
                return current !== undefined && current.modelId !== 0;
              }),
            ).toBe(false);
            expect(await session.readActiveScene()).toBe(activeScene);
            for (const scene of plan.scenes) {
              expect(restored.sceneLabels[scene.index]).toBe(
                before.sceneLabels[scene.index],
              );
            }
          }
        } finally {
          session.close();
          connection.disconnect();
        }
      }
    },
    120_000,
  );
});
