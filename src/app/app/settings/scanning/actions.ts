"use server";

import { revalidatePath } from "next/cache";
import { requireLocalUser } from "@/lib/auth";
import { saveUserSettings, type SettingsOverrides } from "@/lib/settings";

type CadenceOverrides = NonNullable<SettingsOverrides["cadence"]>;
type ThreadOverrides = NonNullable<SettingsOverrides["threads"]>;

/** A whole number a field carried, or undefined when the field was not on the form. */
function whole(formData: FormData, field: string): number | undefined {
  const raw = String(formData.get(field) ?? "").trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${field} has to be a whole number.`);
  }
  return value;
}

/** A yes or no field, or undefined when the form did not carry it. */
function flag(formData: FormData, field: string): boolean | undefined {
  const raw = String(formData.get(field) ?? "");
  return raw ? raw === "yes" : undefined;
}

/** A cap field: a number, or null when it was left empty on purpose. */
function cap(formData: FormData, field: string): number | null | undefined {
  if (!formData.has(field)) {
    return undefined;
  }
  const raw = String(formData.get(field) ?? "").trim();
  return raw ? whole(formData, field) : null;
}

function text(formData: FormData, field: string): string | undefined {
  const raw = String(formData.get(field) ?? "").trim();
  return raw ? raw : undefined;
}

function cadenceFrom(formData: FormData): CadenceOverrides | undefined {
  const cadence: CadenceOverrides = {};
  const hour = whole(formData, "hour");
  const timezone = text(formData, "timezone");
  const hours = whole(formData, "hours");
  if (hour !== undefined) {
    cadence.hour = hour;
  }
  if (timezone !== undefined) {
    cadence.timezone = timezone;
  }
  if (hours !== undefined) {
    cadence.hours = hours;
  }
  return Object.keys(cadence).length > 0 ? cadence : undefined;
}

function threadsFrom(formData: FormData): ThreadOverrides | undefined {
  const threads: ThreadOverrides = {};
  const replyWindowDays = whole(formData, "replyWindowDays");
  const minReplies = whole(formData, "minReplies");
  const threadsPerScan = cap(formData, "threadsPerScan");
  const readOldThreadsOnce = flag(formData, "readOldThreadsOnce");
  const readSeoReplies = flag(formData, "readSeoReplies");
  if (replyWindowDays !== undefined) {
    threads.replyWindowDays = replyWindowDays;
  }
  if (minReplies !== undefined) {
    threads.minReplies = minReplies;
  }
  if (threadsPerScan !== undefined) {
    threads.threadsPerScan = threadsPerScan;
  }
  if (readOldThreadsOnce !== undefined) {
    threads.readOldThreadsOnce = readOldThreadsOnce;
  }
  if (readSeoReplies !== undefined) {
    threads.readSeoReplies = readSeoReplies;
  }
  return Object.keys(threads).length > 0 ? threads : undefined;
}

/**
 * Saves what the Scanning screen changed. The form only carries the fields
 * this user may edit, so anything absent is left to the preset; the settings
 * module drops a key the tier does not allow either way.
 */
export async function saveScanSettingsAction(formData: FormData): Promise<void> {
  const user = await requireLocalUser();
  const overrides: SettingsOverrides = {};
  const cadence = cadenceFrom(formData);
  const threads = threadsFrom(formData);
  if (cadence) {
    overrides.cadence = cadence;
  }
  if (threads) {
    overrides.threads = threads;
  }
  await saveUserSettings(user.id, overrides);
  revalidatePath("/app/settings/scanning");
}
