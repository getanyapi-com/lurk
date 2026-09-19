import { nextManualScanAt } from "@/jobs/enqueue";
import { tierForUser } from "@/lib/tier";

/**
 * When a user may next press Scan now on this project, or null when they may
 * now. Free gets one press a day on top of its daily scan; a connected wallet
 * and a self-hosted instance press as often as they like.
 */
export async function manualScanOpensAt(userId: string, projectId: string): Promise<Date | null> {
  const { limits } = await tierForUser(userId);
  return nextManualScanAt(projectId, limits?.manualScansPerDay ?? null);
}
