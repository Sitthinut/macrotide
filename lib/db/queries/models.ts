import { eq } from "drizzle-orm";
import { getDb } from "../context";
import { modelPortfolios } from "../schema";

export type ModelPortfolio = typeof modelPortfolios.$inferSelect;
export type ModelPortfolioInsert = typeof modelPortfolios.$inferInsert;
export type ModelPortfolioUpdate = Partial<Omit<ModelPortfolioInsert, "id" | "createdAt">>;

export function listModelPortfolios(): ModelPortfolio[] {
  return getDb().select().from(modelPortfolios).orderBy(modelPortfolios.createdAt).all();
}

export function getModelPortfolio(id: string): ModelPortfolio | undefined {
  return getDb().select().from(modelPortfolios).where(eq(modelPortfolios.id, id)).get();
}

export function createModelPortfolio(
  input: Omit<ModelPortfolioInsert, "createdAt">,
): ModelPortfolio {
  return getDb()
    .insert(modelPortfolios)
    .values({ ...input, createdAt: new Date().toISOString() })
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
    .where(eq(modelPortfolios.id, id))
    .returning()
    .get();
}

export function deleteModelPortfolio(id: string): void {
  getDb().delete(modelPortfolios).where(eq(modelPortfolios.id, id)).run();
}
