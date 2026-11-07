import { InputError } from "../shared/errors.js";
export class MapError extends InputError {
  constructor(
    readonly code:
      | "INVALID_ARTIFACT"
      | "MISSING_RUN"
      | "INCOMPATIBLE_FLOWS"
      | "PATH_DENIED"
      | "LIMIT_EXCEEDED"
      | "ROLE_NOT_FOUND"
      | "CANCELLED"
      | "BUSY",
  ) {
    super(
      {
        BUSY: "Another map operation is writing this artifact; retry after it completes.",
        INVALID_ARTIFACT:
          "Map input is corrupt, mismatched or an unsupported version.",
        MISSING_RUN:
          "Run or map not found; use an ID returned by JourneyProof.",
        INCOMPATIBLE_FLOWS:
          "Runs do not describe the same compatible workflow.",
        PATH_DENIED:
          "Map artifact path is unsafe or outside the approved root.",
        LIMIT_EXCEEDED: "Map exceeds the bounded graph or artifact size limit.",
        ROLE_NOT_FOUND: "No source run has that descriptive role label.",
        CANCELLED: "Map operation cancelled.",
      }[code],
    );
  }
}
