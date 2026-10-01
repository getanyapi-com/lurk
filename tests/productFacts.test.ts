import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { describeDb, makeProject, makeUser } from "./fixtures/db";

/**
 * What the product page can and cannot do is a fact the scorer judges against,
 * so it has to survive the profile build in its own columns, reach the scan's
 * product text, and invalidate every stored verdict when a person edits it.
 * Proven against a real database, because the columns are the whole point.
 */

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireLocalUser: async () => ({ id: auth.userId }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

async function fixture(values: Record<string, unknown>) {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const user = await makeUser();
  const project = await makeProject(user.id, { name: "HotelsAllow", ...values });
  auth.userId = user.id;
  return { user, project, db, schema };
}

describeDb("capabilities and exclusions", () => {
  it("reaches the scan's product text as what it can and does not do", async () => {
    const { user, project, db, schema } = await fixture({
      capabilities: ["check in guests aged 18 and over"],
      exclusions: ["anything outside the United States"],
    });
    const { loadScanProject } = await import("@/lib/scan/project");
    const { productText } = await import("@/lib/product");

    const loaded = await loadScanProject(project.id);
    expect(productText(loaded!.product)).toContain("Can: check in guests aged 18 and over");
    expect(productText(loaded!.product)).toContain("Does not: anything outside the United States");
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("says neither line when the page named none", async () => {
    const { user, project, db, schema } = await fixture({});
    const { loadScanProject } = await import("@/lib/scan/project");
    const { productText } = await import("@/lib/product");

    const loaded = await loadScanProject(project.id);
    expect(productText(loaded!.product)).not.toContain("Can:");
    expect(productText(loaded!.product)).not.toContain("Does not:");
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("judges everything again when one is edited, and not when a phrasing is", async () => {
    const { user, project, db, schema } = await fixture({});
    const { addListItemAction, removeListItemAction } = await import(
      "@/app/app/product/actions"
    );

    const version = async () =>
      (await db().select().from(schema.projects).where(eq(schema.projects.id, project.id)))[0]
        .profileVersion;

    await addListItemAction("phrasing", project.id, "hotels that let 19 year olds check in");
    expect(await version()).toBe(1);

    await addListItemAction("capability", project.id, "check in guests aged 18 and over");
    expect(await version()).toBe(2);
    await addListItemAction("exclusion", project.id, "anything outside the United States");
    expect(await version()).toBe(3);

    const loaded = await loadedLists(db, schema, project.id);
    expect(loaded.capabilities).toEqual(["check in guests aged 18 and over"]);
    expect(loaded.exclusions).toEqual(["anything outside the United States"]);
    expect(loaded.problemPhrasings).toEqual(["hotels that let 19 year olds check in"]);

    await removeListItemAction("capability", project.id, "check in guests aged 18 and over");
    expect(await version()).toBe(4);
    expect((await loadedLists(db, schema, project.id)).capabilities).toEqual([]);
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});

/**
 * Who is not a buyer is the only false-positive control the profile has: the
 * judge is told the personas that share this product's vocabulary and never
 * buy, and a persona edit invalidates verdicts exactly as a capability does.
 */
describeDb("who is not a buyer", () => {
  it("reaches the scan's product text as its own line", async () => {
    const { user, project, db, schema } = await fixture({
      notBuyers: ["students looking for a free plan"],
    });
    const { loadScanProject } = await import("@/lib/scan/project");
    const { productText } = await import("@/lib/product");

    const loaded = await loadScanProject(project.id);
    expect(productText(loaded!.product)).toContain("Not a buyer: students looking for a free plan");
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("says no such line when the page named none", async () => {
    const { user, project, db, schema } = await fixture({});
    const { loadScanProject } = await import("@/lib/scan/project");
    const { productText } = await import("@/lib/product");

    const loaded = await loadScanProject(project.id);
    expect(productText(loaded!.product)).not.toContain("Not a buyer:");
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("is saved on its own column and judges everything again when edited", async () => {
    const { user, project, db, schema } = await fixture({});
    const { addListItemAction, removeListItemAction } = await import(
      "@/app/app/product/actions"
    );

    const version = async () =>
      (await db().select().from(schema.projects).where(eq(schema.projects.id, project.id)))[0]
        .profileVersion;

    await addListItemAction("not_buyer", project.id, "students looking for a free plan");
    expect(await version()).toBe(2);
    expect((await loadedLists(db, schema, project.id)).notBuyers).toEqual([
      "students looking for a free plan",
    ]);

    await removeListItemAction("not_buyer", project.id, "students looking for a free plan");
    expect(await version()).toBe(3);
    expect((await loadedLists(db, schema, project.id)).notBuyers).toEqual([]);
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});

/**
 * A competitor a person excluded on the Product page is a decision, not a
 * suggestion: the scan must neither read it nor name it to the judge.
 */
describeDb("an excluded competitor", () => {
  it("is left out of the competitors the scan reads and out of the product text", async () => {
    const { user, project, db, schema } = await fixture({});
    await db()
      .insert(schema.projectCompetitors)
      .values([
        { projectId: project.id, name: "Hotelages", state: "active" },
        { projectId: project.id, name: "Booking", state: "excluded" },
      ]);
    const { loadScanProject } = await import("@/lib/scan/project");
    const { productText } = await import("@/lib/product");

    const loaded = await loadScanProject(project.id);
    expect(loaded?.competitors).toEqual(["Hotelages"]);
    expect(productText(loaded!.product)).toContain("Competitors: Hotelages");
    expect(productText(loaded!.product)).not.toContain("Booking");
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});

async function loadedLists(
  db: typeof import("@/db")["db"],
  schema: typeof import("@/db/schema"),
  projectId: string,
) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  return rows[0];
}
