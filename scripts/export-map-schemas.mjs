import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { mapSchema, observationsSchema } from "../dist/index.js";
await writeFile(
  "docs/MAP_SCHEMAS.json",
  JSON.stringify(
    {
      map: z.toJSONSchema(mapSchema),
      observations: z.toJSONSchema(observationsSchema),
    },
    null,
    2,
  ) + "\n",
);
