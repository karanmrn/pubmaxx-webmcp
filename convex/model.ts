import {
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
  type DataModelFromSchemaDefinition,
  type MutationBuilder,
  type QueryBuilder,
} from "convex/server";
import schema from "./schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;

// Convex normally writes equivalent builders to convex/_generated after a
// deployment is linked. Keeping these local builders avoids requiring a remote
// project merely to typecheck or test PubMax's keyless development mode.
export const query = queryGeneric as QueryBuilder<DataModel, "public">;
export const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
export const internalQuery = internalQueryGeneric as QueryBuilder<
  DataModel,
  "internal"
>;
export const internalMutation = internalMutationGeneric as MutationBuilder<
  DataModel,
  "internal"
>;
