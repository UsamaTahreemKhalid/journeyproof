# Example requests

- “Verify the admission journey and show the first failing step.” Select the existing admissions YAML, validate, run and fetch its returned report.
- “Check whether the last change broke login or approval.” Run the same existing journey against the authorized local app; identify the first observed failed step without guessing the cause.
- “Explain the evidence in the most recent local JourneyProof report.” Obtain a real run ID from available local run metadata or the user. Fetch that report and explain actual counts, HTTP failures and missing evidence. Do not invent a latest-report tool.
- “Fix a bug and rerun the same journey to verify the result.” Only when code changes are authorized: establish an actual failure, inspect local source, fix minimally, reset fixture state where necessary and rerun the same flow. Record both run IDs and distinguish symptoms from diagnosis.

- “Map this admission run and compare it with the failing run.” Use the two real selected IDs, explain first changed step outcomes, distinguish linked/unvisited from observed, and provide the local viewer location. Never interpret an absent transition as a deleted screen.
