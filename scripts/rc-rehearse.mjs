import { verifyReleaseCandidate } from "../dist/index.js";
import { rehearse } from "./lib/rehearse.mjs";
await rehearse("rc", verifyReleaseCandidate);
