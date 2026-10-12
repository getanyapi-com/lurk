import { afterEach, expect, it, vi } from "vitest";
import { xPreviewOnly } from "@/lib/x/preview";
import { openXAction, scanXNowAction } from "@/app/app/x/actions";
import { requireXProject } from "@/lib/owned";
import { openX } from "@/lib/x/open";
import { pressForJob } from "@/lib/throttle";

vi.mock("@/lib/owned", () => ({ requireXProject: vi.fn() }));
vi.mock("@/lib/x/open", () => ({ openX: vi.fn() }));
vi.mock("@/lib/throttle", () => ({ pressForJob: vi.fn() }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("does not enqueue or spend an allowance when opening/pressing scan in the local preview", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LURK_X_PREVIEW_ONLY", "true");
  expect(xPreviewOnly()).toBe(true);
  await openXAction("saved-project");
  await expect(scanXNowAction("saved-project")).rejects.toThrow("Scans are disabled");
  expect(openX).not.toHaveBeenCalled();
  expect(pressForJob).not.toHaveBeenCalled();
  expect(requireXProject).not.toHaveBeenCalled();
});

it("cannot suppress production's normal ownership checks or opening behaviour", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LURK_X_PREVIEW_ONLY", "true");
  expect(xPreviewOnly()).toBe(false);
  vi.mocked(requireXProject).mockRejectedValue(new Error("Normal ownership check reached"));
  await expect(openXAction("project")).rejects.toThrow("Normal ownership check reached");
  await expect(scanXNowAction("project")).rejects.toThrow("Normal ownership check reached");
});
