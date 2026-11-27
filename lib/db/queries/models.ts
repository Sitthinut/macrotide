import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "../context";
import { modelPortfolios } from "../schema";
import { ownedBy, ownerId, pickEditable } from "./scope";

export type ModelPortfolio = typeof modelPortfolios.$inferSelect;
export type ModelPortfolioInsert = typeof modelPortfolios.$inferInsert;

/**
 * The columns a model-portfolio update may change. Ownership, the id, the
 * creation time and `builtIn` (which shares a row with every user) are
 * server-managed.
 */
export const MODEL_PORTFOLIO_EDITABLE_FIELDS = [
  "name",
  "tagline",
  "blurb",
  "allocation",
  "expectedReturn",
  "expectedVolatility",
  "ter",
  "horizon",
  "risk",
  "pros",
  "cons",
] as const;
export type ModelPortfolioUpdate = Partial<
  Pick<ModelPortfolioInsert, (typeof MODEL_PORTFOLIO_EDITABLE_FIELDS)[number]>
>;

export function listModelPortfolios(): ModelPortfolio[] {
  return (
    getDb()
      .select()
      .from(modelPortfolios)
      // Built-ins are null-owned on purpose and shared with every user.
      .where(ownedBy(modelPortfolios.userId, { alsoWhere: eq(modelPortfolios.builtIn, true) }))
      .orderBy(modelPortfolios.createdAt)
      .all()
  );
}

export function getModelPortfolio(id: string): ModelPortfolio | undefined {
  return getDb()
    .select()
    .from(modelPortfolios)
    .where(
      and(
        eq(modelPortfolios.id, id),
        // Built-ins are readable by everyone; user customizations are private.
        ownedBy(modelPortfolios.userId, { alsoWhere: eq(modelPortfolios.builtIn, true) }),
      ),
    )
    .get();
}

export function createModelPortfolio(
  input: Omit<ModelPortfolioInsert, "createdAt">,
): ModelPortfolio {
  return (
    getDb()
      .insert(modelPortfolios)
      // Stamp ownership AFTER the input spread so a client-supplied `userId` can't
      // override the server's owner scoping. `builtIn` is sanitized at the
      // route — the seeder legitimately sets it true through this same path.
      .values({ ...input, userId: ownerId(), createdAt: new Date().toISOString() })
      .returning()
      .get()
  );
}

export function updateModelPortfolio(
  id: string,
  patch: ModelPortfolioUpdate,
): ModelPortfolio | undefined {
  const owned = and(eq(modelPortfolios.id, id), ownedBy(modelPortfolios.userId));
  const set = pickEditable(patch, MODEL_PORTFOLIO_EDITABLE_FIELDS);
  if (Object.keys(set).length === 0) {
    return getDb().select().from(modelPortfolios).where(owned).get();
  }
  return getDb().update(modelPortfolios).set(set).where(owned).returning().get();
}

export function deleteModelPortfolio(id: string): void {
  getDb()
    .delete(modelPortfolios)
    .where(and(eq(modelPortfolios.id, id), ownedBy(modelPortfolios.userId)))
    .run();
}
