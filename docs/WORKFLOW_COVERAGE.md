# Workflow coverage

```bash
node dist/cli.js coverage --flow examples/admissions-demo/journeys/happy-path.yaml --runs HEALTHY_ID,BROKEN_ID --format table
node dist/cli.js coverage --flow examples/admissions-demo/journeys/happy-path.yaml --runs HEALTHY_ID --format json
```

The command reads 1–20 distinct saved runs from the fixed workspace artifact root. They must match the exact current YAML checksum and ordered step IDs/actions. It writes nothing. JSON has `schemaVersion:1`, checksum, descriptive role, scope, declared count, union reached/asserted numerator/denominator, and per-run counts plus stable step rows. Missing/corrupt runs are errors. Missing legacy observations are unknown; corrupt present observations are errors.

| Quantity        | Definition                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| declared        | concrete steps in the selected YAML; denominator for step proportions                                                        |
| reached         | matching actual step observation and run outcome                                                                             |
| asserted        | reached step whose action is an explicit `expect*` assertion; includes failed assertions                                     |
| passed          | reached explicit assertions with passed outcomes; successful clicks/fills do not count                                       |
| failed          | reached steps with failed required operation/check; action failures count too                                                |
| notReached      | explicitly skipped declared steps after stopping; these are not failures                                                     |
| unknown         | non-skipped steps without corresponding observations                                                                         |
| supported       | reached successful steps translatable by the current schema; response assertions additionally require unambiguous HTTP proof |
| linkedUnvisited | unique recorded passive link targets without recorded navigation; outside the step denominator; null if observations absent  |
| incomplete      | absent or truncated observations; missing events are not invented                                                            |

The current strict YAML schema admits only supported actions. Unknown actions fail validation. `supported` measures per-step successful translation evidence, not final-spec eligibility; a failed run, missing linkage, private definition or missing final business assertion can still block generation. A passed assertion means the configured requirement passed, not every possible requirement. The union de-duplicates stable step IDs across selected runs. It does not combine successes and failures into a misleading green outcome.

The executed admissions demonstration has 15 declared steps:

| Run               | Reached | Asserted | Passed assertions | Failed | Not reached | Unknown | Supported | Linked unvisited |
| ----------------- | ------- | -------- | ----------------- | ------ | ----------- | ------- | --------- | ---------------- |
| healthy           | 15/15   | 7/15     | 7                 | 0      | 0           | 0       | 15        | 1                |
| approval HTTP 500 | 14/15   | 6/15     | 5                 | 1      | 1           | 0       | 13        | 1                |

Union reached is 15/15 (100% of declared steps); executed assertion coverage is 7/15 (46.67%). Healthy expected assertions passed 7/7; broken executed assertions passed 5/6. The final Approved text check is not reached in the broken run. The discovered guide remains unvisited. No route, code, application-wide, risk or RBAC score is inferred. Role labels are descriptive. See real run IDs in [installed demo guide](REPORTS.md) and the latest ignored `.journeyproof/regression-demo/manifest.json`.

The existing workflow explorer stays compatible. It displays the real generated-run observations, failure evidence and first divergence; this separate CLI summary supplies stricter explicit-assertion counts. Its `passed` metric must not be confused with the map's earlier `passedSteps`, which counts successful operations.
