# makefun-gta6-trophy-rarity-forecast-01

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/rikonprdy/makefun-gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/rikonprdy/makefun-gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

A program that forecasts every Grand Theft Auto VI trophy's Exophase earn rate at the case's target, as five quantiles per trophy, scored by mean pinball loss on the logit scale.

The house baseline is persistence (rates stay where they are), which misses what a launch does to Exophase rates: dilution as millions of new players are tracked, and early-content trophies climbing steeply, then saturating. So each trophy is fitted with a saturating curve — an exponential approach to an asymptote, chosen by grid search on the logit scale — and the median is an ensemble of that forecast with persistence, hedging the asymptote that two days of data cannot pin down. The spread comes from the fit's recent residuals, the biggest refresh jump in the last day, and the size of the move the fit wants. A trophy at 100% can only dilute down; a trophy never earned yet gets a tier-flavoured prior instead of a pin at 0.01%.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `*.in` in the input directory and writes `<id>.out` per case. Node 22, standard library only, offline, deterministic.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wpdqfrv1&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
