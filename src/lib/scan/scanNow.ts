import { tierForUser } from "@/lib/tier";

/**
 * Whether this user may press Scan now. Free scans only on its daily schedule;
 * a connected wallet and a self-hosted instance scan whenever they like.
 */
export async function canScanNow(userId: string): Promise<boolean> {
  const { limits } = await tierForUser(userId);
  return limits?.scanNow ?? true;
}
