from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

UNKNOWN = -1


class AbstainingClassifier:
    """Wraps a probabilistic classifier and returns UNKNOWN (−1) when the top-class probability is
    below `threshold`. Required so low-confidence windows never become drinking prompts."""

    def __init__(self, model: Any, threshold: float = 0.8) -> None:
        if not 0 < threshold <= 1:
            raise ValueError("threshold must be in (0, 1]")
        self.model = model
        self.threshold = threshold

    def predict_proba(self, X: Any) -> NDArray[np.float64]:
        return np.asarray(self.model.predict_proba(X))

    def predict(self, X: Any) -> NDArray[np.int64]:
        p = self.predict_proba(X)
        classes = np.asarray(self.model.classes_)
        top = np.argmax(p, axis=1)
        out = classes[top].astype(np.int64)
        out[p[np.arange(len(p)), top] < self.threshold] = UNKNOWN
        return out

    def coverage(self, X: Any) -> float:
        return float(np.mean(self.predict(X) != UNKNOWN))
