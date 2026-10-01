import { eq } from "drizzle-orm";
import { expect, expectTypeOf, it } from "vitest";
import { db } from "@/db";
import { leads, projects, redditComments, redditPosts } from "@/db/schema";
import { leadsBase } from "@/lib/leadSql";
import { describeDb } from "./fixtures/db";

/**
 * leadsBase builds its joins over any selection and is typed by hand, because
 * drizzle cannot type the chain over one it has not seen. These hold the hand
 * typing to what drizzle says of the same chain written out, with a column
 * from each table so a wrong guess at whether one can be missing shows up.
 */

const fields = {
  id: leads.id,
  title: redditPosts.title,
  commentId: redditComments.id,
  owner: projects.userId,
};

function writtenOut() {
  return db()
    .select(fields)
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .innerJoin(projects, eq(projects.id, leads.projectId));
}

type Rows<T extends () => PromiseLike<unknown>> = Awaited<ReturnType<T>>;

describeDb("leadsBase", () => {
  it("is the four-table join written out, in its SQL and in its rows", () => {
    expect(leadsBase(fields).toSQL()).toEqual(writtenOut().toSQL());
    expectTypeOf<Rows<() => ReturnType<typeof leadsBase<typeof fields>>>>().toEqualTypeOf<
      Rows<typeof writtenOut>
    >();
  });
});
