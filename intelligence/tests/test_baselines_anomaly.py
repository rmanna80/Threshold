from __future__ import annotations

import numpy as np
import pytest
from threshold_intelligence.baseline_engine import (
    cusum_change_points,
    ewma,
    isolation_forest_scores,
    mad,
    mahalanobis_distances,
    maturity,
    median,
    percentile,
    robust_z,
)
from threshold_intelligence.consumption_engine import PaceEvent
from threshold_intelligence.intervention_engine import simulate_prompts


def test_robust_stats_match_typescript_definitions() -> None:
    assert median([4, 1, 3, 2]) == 2.5
    assert mad([1, 1, 2, 2, 4, 6, 9]) == 1
    assert robust_z(10, 6, 2) == pytest.approx(0.6745 * 2)
    assert robust_z(10, 6, 0) is None
    assert percentile([1, 2, 3, 4], 25) == pytest.approx(1.75)
    assert ewma([10, 20, 30], 0.5) == 22.5
    assert maturity(20, 20) == "established" and maturity(3, 3) == "insufficient"


def test_multivariate_anomalies_rank_outliers_highest() -> None:
    rng = np.random.default_rng(0)
    ref = rng.normal(size=(200, 3))
    query = np.vstack([np.zeros(3), np.full(3, 6.0)])
    d = mahalanobis_distances(ref, query)
    assert d[1] > d[0] * 5
    s = isolation_forest_scores(ref, query)
    assert s[1] > s[0]
    with pytest.raises(ValueError):
        mahalanobis_distances(ref[:3], query)


def test_cusum_detects_level_shift() -> None:
    x = np.concatenate([np.zeros(50), np.full(50, 2.0)])
    cps = cusum_change_points(x, target=0.0, k=0.5, h=4.0)
    assert cps and 50 <= cps[0] <= 55


def test_prompt_simulation_respects_frequency_caps() -> None:
    events = [PaceEvent(f"e{i}", i * 5 * 60_000, 1.0, 1, 0, True) for i in range(12)]
    minimal = simulate_prompts(events, "minimal")
    frequent = simulate_prompts(events, "frequent")
    assert minimal["count"] <= frequent["count"]
    assert minimal["count"] <= 4
    gaps = np.diff([d["at"] for d in minimal["delivered"]])
    assert (gaps >= 30 * 60_000).all()
