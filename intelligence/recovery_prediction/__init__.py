"""Next-day recovery modelling: session features (sf-v1), datasets from app exports, model
families, evaluation against the base rate, and a clearly-labelled synthetic generator."""

from .dataset import RecoveryDataset, dataset_from_rows, load_export_dir, rows_from_export
from .features import SESSION_FEATURE_NAMES, SESSION_FEATURE_VERSION, build_session_features

__all__ = [
    "SESSION_FEATURE_NAMES",
    "SESSION_FEATURE_VERSION",
    "RecoveryDataset",
    "build_session_features",
    "dataset_from_rows",
    "load_export_dir",
    "rows_from_export",
]
