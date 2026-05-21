import { eq } from "drizzle-orm";
import { db } from "../client";
import { modelPortfolios } from "../schema";

export type ModelPortfolio = typeof modelPortfolios.$inferSelect;
export type ModelPortfolioInsert = typeof modelPortfolios.$inferInsert;
export type ModelPortfolioUpdate = Partial<Omit<ModelPortfolioInsert, "id" | "createdAt">>;

export function listModelPortfolios(): ModelPortfolio[] {
  return db.select().from(modelPortfolios).orderBy(modelPortfolios.createdAt).all();
}

export function getModelPortfolio(id: string): ModelPortfolio | undefined {
  return db.select().from(modelPortfolios).where(eq(modelPortfolios.id, id)).get();
}

export function createModelPortfolio(
  input: Omit<ModelPortfolioInsert, "createdAt">,
): ModelPortfolio {
  return db
    .insert(modelPortfolios)
    .values({ ...input, createdAt: new Date().toISOString() })
    .returning()
    .get();
}

export function updateModelPortfolio(
  id: string,
  patch: ModelPortfolioUpdate,
): ModelPortfolio | undefined {
  return db.update(modelPortfolios).set(patch).where(eq(modelPortfolios.id, id)).returning().get();
}

export function deleteModelPortfolio(id: string): void {
  db.delete(modelPortfolios).where(eq(modelPortfolios.id, id)).run();
}
