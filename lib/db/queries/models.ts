import { and, eq } from "drizzle-orm";
import { getDb } from "../context";
import { modelPortfolios } from "../schema";
import { ownedBy, ownerId } from "./scope";

export type ModelPortfolio = typeof modelPortfolios.$inferSelect;
export type ModelPortfolioInsert = typeof modelPortfolios.$inferInsert;
export type ModelPortfolioUpdate = Partial<Omit<ModelPortfolioInsert, "id" | "createdAt">>;

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
  return getDb()
    .insert(modelPortfolios)
    .values({ userId: ownerId(), ...input, createdAt: new Date().toISOString() })
    .returning()
    .get();
}

export function updateModelPortfolio(
  id: string,
  patch: ModelPortfolioUpdate,
): ModelPortfolio | undefined {
  return getDb()
    .update(modelPortfolios)
    .set(patch)
    .where(and(eq(modelPortfolios.id, id), ownedBy(modelPortfolios.userId)))
    .returning()
    .get();
}

export function deleteModelPortfolio(id: string): void {
  getDb()
    .delete(modelPortfolios)
    .where(and(eq(modelPortfolios.id, id), ownedBy(modelPortfolios.userId)))
    .run();
}
