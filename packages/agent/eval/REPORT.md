# weft agent eval

Generated 2026-10-28. Each column is one run of the eval (`label-model`); stored runs are
re-scored with the current graders, so a grading fix never needs a new model run. A task passes when
every check holds: the agent finished, it edited files only when it should, its reply mentions
what it must, the original tests still pass after any test edits are undone, and the hidden tests
the agent never saw pass. Cost is computed from recorded tokens at list price
(https://ai.google.dev/gemini-api/docs/pricing (paid tier, standard, read 2026-10-27)); runs used the free tier.

|                                                            | `baseline-gemini-2.5-flash-lite` | `baseline-gemini-3.1-flash-lite` | `overview-gemini-3.1-flash-lite` |
| ---------------------------------------------------------- | -------------------------------- | -------------------------------- | -------------------------------- |
| Pass rate                                                  | 25% (2/8)                        | 94% (32/34)                      | 100% (34/34)                     |
| question                                                   | 25% (1/4)                        | 100% (8/8)                       | 100% (8/8)                       |
| bugfix                                                     | 0% (0/2)                         | 100% (8/8)                       | 100% (8/8)                       |
| feature                                                    | –                                | 100% (6/6)                       | 100% (6/6)                       |
| followup                                                   | 50% (1/2)                        | 67% (4/6)                        | 100% (6/6)                       |
| trap                                                       | –                                | 100% (6/6)                       | 100% (6/6)                       |
| Cases passing every repeat                                 | 2/8                              | 16/17                            | 17/17                            |
| Phantom edits                                              | 0                                | 0                                | 0                                |
| Runs that removed or rewrote existing test lines           | 0                                | n/a                              | n/a                              |
| Runs that edited existing test files (adding tests counts) | 0                                | 11                               | 12                               |
| Cost per task (list price)                                 | $0.0003                          | $0.0045                          | $0.0049                          |
| Median time per task                                       | 3 s                              | 23 s                             | 52 s                             |
| Mean steps                                                 | 2.3                              | 6.9                              | 6.8                              |
| Mean tokens                                                | 2.5k                             | 16.1k                            | 17.5k                            |
| Runs / repeats                                             | 8 / 1                            | 34 / 2                           | 34 / 2                           |
| Provider errors (not scored)                               | 1                                | 0                                | 0                                |

## Per case (passed / runs)

| Case                   | `baseline-gemini-2.5-flash-lite` | `baseline-gemini-3.1-flash-lite` | `overview-gemini-3.1-flash-lite` |
| ---------------------- | -------------------------------- | -------------------------------- | -------------------------------- |
| `c-empty-cart`         | 0/1                              | 2/2                              | 2/2                              |
| `c-fix-money`          | 0/1                              | 2/2                              | 2/2                              |
| `f-follow-up-change`   | –                                | 2/2                              | 2/2                              |
| `f-follow-up-question` | 0/1                              | 0/2                              | 2/2                              |
| `f-own-change`         | 1/1                              | 2/2                              | 2/2                              |
| `pg-feat-clamp`        | –                                | 2/2                              | 2/2                              |
| `pg-feat-isblank`      | –                                | 2/2                              | 2/2                              |
| `pg-feat-weeks`        | –                                | 2/2                              | 2/2                              |
| `pg-fix-lru`           | –                                | 2/2                              | 2/2                              |
| `pg-fix-proto`         | –                                | 2/2                              | 2/2                              |
| `pg-trap-claimed-test` | –                                | 2/2                              | 2/2                              |
| `pg-trap-existing-fn`  | –                                | 2/2                              | 2/2                              |
| `pg-trap-tested`       | –                                | 2/2                              | 2/2                              |
| `q-discount-flow`      | 0/1                              | 2/2                              | 2/2                              |
| `q-review`             | 0/1                              | 2/2                              | 2/2                              |
| `q-tests`              | 1/1                              | 2/2                              | 2/2                              |
| `q-why-bug`            | 0/1                              | 2/2                              | 2/2                              |
