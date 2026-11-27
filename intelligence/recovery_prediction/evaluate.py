"""Evaluation of recovery models.

Reported for every family, always against the base-rate reference:
  * participant-separated K-fold (no person in both train and test), out-of-fold predictions
  * temporal holdout (train on earlier sessions, test on later ones; no look-ahead)
  * Brier, Brier skill vs base rate, calibration error, reliability curve, AUROC, AUPRC,
    participant-cluster bootstrap CIs
  * severity regression MAE vs the training mean; ordinal ranked probability score
  * personalization (partial pooling) vs population model on each person's later sessions
  * missing-data analysis: availability, outcome missingness and its association with features,
    performance by input quality
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.metrics import average_precision_score, roc_auc_score

from ..evaluation.metrics import (
    binary_brier,
    binary_ece,
    brier_skill_score,
    cluster_bootstrap_ci,
    ranked_probability_score,
    reliability_curve,
)
from ..evaluation.splits import assert_no_leakage, participant_folds, temporal_split
from ..personalization import DEFAULT_MIN_HISTORY, GaussianPartialPooling, LogisticPartialPooling
from .dataset import RecoveryDataset
from .features import FEATURE_GROUPS
from .models import BINARY_FAMILIES, REGRESSION_FAMILIES, OrdinalFrankHall, build_binary, build_regressor

EPS = 1e-6


def _logit(p: NDArray[np.float64]) -> NDArray[np.float64]:
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def _fit_predict(family: str, X_tr: NDArray[np.float64], y_tr: NDArray[np.int64], X_te: NDArray[np.float64]) -> NDArray[np.float64]:
    model = build_binary(family) if len(np.unique(y_tr)) > 1 else build_binary("base_rate")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model.fit(X_tr, y_tr)
        return np.asarray(model.predict_proba(X_te)[:, 1], dtype=float)


def _binary_report(
    y: NDArray[np.int64], p: NDArray[np.float64], p_ref: NDArray[np.float64], groups: NDArray[np.str_], n_boot: int
) -> dict[str, Any]:
    both = len(np.unique(y)) > 1
    out: dict[str, Any] = {
        "n": int(len(y)),
        "prevalence": float(np.mean(y)),
        "brier": binary_brier(y, p),
        "brier_reference": binary_brier(y, p_ref),
        "brier_skill": brier_skill_score(y, p, p_ref),
        "ece": binary_ece(y, p),
        "auroc": float(roc_auc_score(y, p)) if both else None,
        "auprc": float(average_precision_score(y, p)) if both else None,
        "reliability": reliability_curve(p, y.astype(bool)),
    }
    if len(np.unique(groups)) > 1 and n_boot > 0:
        out["brier_skill_ci"] = cluster_bootstrap_ci(groups, lambda i: brier_skill_score(y[i], p[i], p_ref[i]), n_boot=n_boot)
        if both:

            def auc(i: NDArray[np.int64]) -> float:
                return float(roc_auc_score(y[i], p[i])) if len(np.unique(y[i])) > 1 else float("nan")

            lo, hi = cluster_bootstrap_ci(groups, auc, n_boot=n_boot)
            out["auroc_ci"] = (lo, hi)
    return out


def participant_separated(
    ds: RecoveryDataset, families: tuple[str, ...] = BINARY_FAMILIES, n_splits: int = 5, n_boot: int = 200
) -> dict[str, Any]:
    y = ds.binary
    oof = {f: np.full(len(ds), np.nan) for f in families}
    for train, test in participant_folds(ds.groups, n_splits):
        for f in families:
            oof[f][test] = _fit_predict(f, ds.X[train], y[train], ds.X[test])
    ref = oof.get("base_rate")
    if ref is None:
        ref = np.full(len(ds), np.nan)
        for train, test in participant_folds(ds.groups, n_splits):
            ref[test] = y[train].mean()
    return {"families": {f: _binary_report(y, oof[f], ref, ds.groups, n_boot) for f in families}, "oof": oof, "reference": ref}


def temporal_holdout(
    ds: RecoveryDataset, families: tuple[str, ...] = BINARY_FAMILIES, test_fraction: float = 0.25, n_boot: int = 200
) -> dict[str, Any]:
    train, test = temporal_split(ds.times, test_fraction)
    if ds.times[train].max() > ds.times[test].min():
        raise AssertionError("temporal split looks ahead")
    y = ds.binary
    ref = np.full(len(test), y[train].mean())
    out = {f: _binary_report(y[test], _fit_predict(f, ds.X[train], y[train], ds.X[test]), ref, ds.groups[test], n_boot) for f in families}
    return {"train_until": float(ds.times[train].max()), "test_from": float(ds.times[test].min()), "families": out}


def regression(ds: RecoveryDataset, n_splits: int = 5, n_boot: int = 200) -> dict[str, Any]:
    y = ds.severity
    oof = {f: np.full(len(ds), np.nan) for f in REGRESSION_FAMILIES}
    for train, test in participant_folds(ds.groups, n_splits):
        for f in REGRESSION_FAMILIES:
            m = build_regressor(f).fit(ds.X[train], y[train])
            oof[f][test] = np.clip(m.predict(ds.X[test]), 0, 10)
    out = {}
    for f, pred in oof.items():
        err = np.abs(pred - y)
        rep: dict[str, Any] = {"mae": float(err.mean())}
        if n_boot > 0:

            def mae(i: NDArray[np.int64], e: NDArray[np.float64] = err) -> float:
                return float(e[i].mean())

            rep["mae_ci"] = cluster_bootstrap_ci(ds.groups, mae, n_boot=n_boot)
        out[f] = rep
    return out


def ordinal(ds: RecoveryDataset, n_splits: int = 5) -> dict[str, Any]:
    edges = (3, ds.severity_threshold)
    bands = np.digitize(ds.severity, edges).astype(np.int64)  # 0: <3, 1: 3..threshold-1, 2: >= threshold
    probs = np.zeros((len(ds), 3))
    ref = np.zeros((len(ds), 3))
    for train, test in participant_folds(ds.groups, n_splits):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            probs[test] = OrdinalFrankHall(3).fit(ds.X[train], bands[train]).predict_proba(ds.X[test])
        ref[test] = np.bincount(bands[train], minlength=3) / len(train)
    rps, rps_ref = ranked_probability_score(bands, probs), ranked_probability_score(bands, ref)
    return {
        "band_edges": list(edges),
        "rps": rps,
        "rps_reference": rps_ref,
        "rps_skill": float(1 - rps / rps_ref) if rps_ref > 0 else 0.0,
        "band_mae": float(np.mean(np.abs(np.argmax(probs, axis=1) - bands))),
    }


def personalization(
    ds: RecoveryDataset, family: str = "logistic", min_history: int = DEFAULT_MIN_HISTORY, n_splits: int = 5
) -> dict[str, Any]:
    """Population model from other people (participant-separated); each person's offset is learned
    from their EARLIER half of sessions and evaluated on the later half."""
    y = ds.binary
    pop_p, pers_p, eval_mask = np.full(len(ds), np.nan), np.full(len(ds), np.nan), np.zeros(len(ds), dtype=bool)
    personalized_users, cold_start_users = 0, 0
    sigmas = []
    for train, test in participant_folds(ds.groups, n_splits):
        assert_no_leakage(ds.groups[train], ds.groups[test])
        p = _fit_predict(family, ds.X[train], y[train], ds.X[test])
        logit = _logit(p)
        hist_idx: list[int] = []
        later_idx: list[int] = []
        for g in np.unique(ds.groups[test]):
            local = np.flatnonzero(ds.groups[test] == g)
            order = local[np.argsort(ds.times[test][local], kind="stable")]
            half = len(order) // 2
            hist_idx.extend(order[:half])
            later_idx.extend(order[half:])
        hist, later = np.asarray(hist_idx, dtype=np.int64), np.asarray(later_idx, dtype=np.int64)
        pool = LogisticPartialPooling(min_history=min_history).fit(logit[hist], y[test][hist], ds.groups[test][hist])
        sigmas.append(pool.sigma)
        for g in np.unique(ds.groups[test][later]):
            if pool.personalized(str(g)):
                personalized_users += 1
            else:
                cold_start_users += 1
        idx = test[later]
        pop_p[idx] = p[later]
        pers_p[idx] = 1 / (1 + np.exp(-pool.adjust(logit[later], list(ds.groups[test][later]))))
        eval_mask[idx] = True
    yy = y[eval_mask]
    # Severity: Gaussian partial pooling of residuals from a ridge population model.
    resid_report: dict[str, Any] = {}
    sev = ds.severity
    pop_mae: list[float] = []
    pers_mae: list[float] = []
    for train, test in participant_folds(ds.groups, n_splits):
        m = build_regressor("ridge").fit(ds.X[train], sev[train])
        pred = m.predict(ds.X[test])
        order = np.argsort(ds.times[test], kind="stable")
        hist_mask: NDArray[np.bool_] = np.zeros(len(test), dtype=bool)
        for g in np.unique(ds.groups[test]):
            local = order[ds.groups[test][order] == g]
            hist_mask[local[: len(local) // 2]] = True
        gp = GaussianPartialPooling(min_history=min_history).fit(sev[test][hist_mask] - pred[hist_mask], ds.groups[test][hist_mask])
        later_mask = ~hist_mask
        pop_mae.extend(np.abs(pred[later_mask] - sev[test][later_mask]))
        pers_mae.extend(np.abs(np.clip(gp.adjust(pred[later_mask], list(ds.groups[test][later_mask])), 0, 10) - sev[test][later_mask]))
    resid_report = {"population_mae": float(np.mean(pop_mae)), "personalized_mae": float(np.mean(pers_mae))}
    return {
        "family": family,
        "min_history": min_history,
        "selected_sigma": [float(s) for s in sigmas if s is not None],
        "n_eval": int(eval_mask.sum()),
        "users_personalized": personalized_users,
        "users_cold_start": cold_start_users,
        "population_brier": binary_brier(yy, pop_p[eval_mask]),
        "personalized_brier": binary_brier(yy, pers_p[eval_mask]),
        "severity": resid_report,
    }


def missing_data(full: RecoveryDataset, labelled: RecoveryDataset, oof: NDArray[np.float64], ref: NDArray[np.float64]) -> dict[str, Any]:
    has = full.has_outcome
    std_idx = full.feature_names.index("std_drinks_known")
    peak_idx = full.feature_names.index("peak_std_60min")

    def smd(col: int) -> float | None:
        a, b = full.X[has, col], full.X[~has, col]
        a, b = a[~np.isnan(a)], b[~np.isnan(b)]
        if len(a) < 2 or len(b) < 2:
            return None
        pooled = np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2)
        return float((a.mean() - b.mean()) / pooled) if pooled > 0 else 0.0

    y = labelled.binary
    by_quality = {}
    for q in ("high", "medium", "low"):
        m = np.asarray([iq == q for iq in labelled.input_quality])
        if m.sum() >= 5:
            by_quality[q] = {"n": int(m.sum()), "brier": binary_brier(y[m], oof[m]), "brier_skill": brier_skill_score(y[m], oof[m], ref[m])}
    outcome_by_availability = {}
    for g in FEATURE_GROUPS:
        a = labelled.availability[g]
        outcome_by_availability[g] = {
            "rate_when_available": float(y[a].mean()) if a.any() else None,
            "rate_when_missing": float(y[~a].mean()) if (~a).any() else None,
        }
    return {
        "availability_rate": {g: float(v.mean()) for g, v in full.availability.items()},
        "outcome_missing_rate": float(1 - has.mean()),
        "standardized_mean_difference_with_vs_without_checkin": {"std_drinks_known": smd(std_idx), "peak_std_60min": smd(peak_idx)},
        "outcome_rate_by_feature_availability": outcome_by_availability,
        "performance_by_input_quality": by_quality,
        "notes": [
            "Sessions without a check-in are excluded from training and evaluation; a non-zero standardized mean "
            "difference means check-ins are not missing completely at random and estimates may be biased.",
            "Features are never imputed in the app; models impute medians with missing indicators (or handle NaN natively).",
        ],
    }


def select_best(families: dict[str, dict[str, Any]]) -> dict[str, Any]:
    candidates = {f: r for f, r in families.items() if f != "base_rate"}
    if not candidates:
        return {"status": "none"}
    f, r = max(candidates.items(), key=lambda kv: kv[1]["brier_skill"])
    return {"family": f, "brier_skill": r["brier_skill"], "ece": r["ece"], "auroc": r["auroc"], "brier_skill_ci": r.get("brier_skill_ci")}


def evaluate(ds_full: RecoveryDataset, n_splits: int = 5, n_boot: int = 200) -> dict[str, Any]:
    ds = ds_full.labelled()
    if len(np.unique(ds.groups)) < 2:
        raise ValueError("needs labelled sessions from at least two participants")
    ps = participant_separated(ds, n_splits=n_splits, n_boot=n_boot)
    oof, ref = ps.pop("oof"), ps.pop("reference")
    best_family = select_best(ps["families"]).get("family", "logistic")
    return {
        "participant_separated": ps["families"],
        "temporal": temporal_holdout(ds, n_boot=n_boot),
        "regression": regression(ds, n_splits=n_splits, n_boot=n_boot),
        "ordinal": ordinal(ds, n_splits=n_splits),
        "personalization": personalization(ds, n_splits=n_splits),
        "missing_data": missing_data(ds_full, ds, oof["logistic"] if "logistic" in oof else oof[best_family], ref),
        "best": select_best(ps["families"]),
    }
