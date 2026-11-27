import { z } from "zod";

// Request-body schema for creating or editing a portfolio (bucket). Only the
// editable columns pass; zod drops every other key, so a client can't set the
// id, owner, position or timestamps, and every text field has a length cap.

/** Portfolio name length, for every way a portfolio gets created or renamed. */
export const MAX_PORTFOLIO_NAME_LENGTH = 200;

const shortText = (max: number) => z.string().trim().max(max);
const longText = z.string().max(2000);
const share = z.number().finite().min(0).max(100);

export const bucketCreateSchema = z.object({
  name: z.string().trim().min(1).max(MAX_PORTFOLIO_NAME_LENGTH),
  typeLabel: shortText(60).nullish(),
  icon: shortText(64).nullish(),
  color: shortText(64).nullish(),
  // A broker sync stores the account code here; manual portfolios get a dash.
  brokerage: shortText(64).nullish(),
  notes: longText.nullish(),
  goalText: longText.nullish(),
  targetModelId: shortText(100).nullish(),
  targetAllocation: z
    .object({ equity: share, bond: share, alternative: share, cash: share })
    .nullish(),
});

// An edit resends the name as it is, and older portfolios may predate the name
// limit, so the edit route checks the limit only when the name changes.
export const bucketUpdateSchema = bucketCreateSchema
  .partial()
  .extend({ name: z.string().trim().min(1).optional() });
