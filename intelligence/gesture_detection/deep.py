"""PyTorch sequence models (1D-CNN, TCN, GRU) wrapped in a scikit-learn-like interface.

Requires the optional `deep` extra (torch). If torch is unavailable, building these models
raises DependencyUnavailable so evaluations report the family as "not run" instead of
fabricating results. The CNN's input layout ([batch, 6, 128]) matches the Core ML interface
expected by apps/watch/ThresholdWatch/Intelligence/GestureDetector.swift.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from .models import DependencyUnavailable


def _torch() -> Any:
    try:
        import torch
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise DependencyUnavailable("torch is not installed (pip install '.[deep]')") from exc
    return torch


def _make_network(name: str, n_classes: int, channels: int = 6) -> Any:
    torch = _torch()
    nn = torch.nn

    class CNN1D(nn.Module):  # type: ignore[misc]
        def __init__(self) -> None:
            super().__init__()
            self.net = nn.Sequential(
                nn.Conv1d(channels, 32, 5, padding=2),
                nn.BatchNorm1d(32),
                nn.ReLU(),
                nn.MaxPool1d(2),
                nn.Conv1d(32, 64, 5, padding=2),
                nn.BatchNorm1d(64),
                nn.ReLU(),
                nn.MaxPool1d(2),
                nn.Conv1d(64, 64, 3, padding=1),
                nn.ReLU(),
                nn.AdaptiveAvgPool1d(1),
                nn.Flatten(),
                nn.Dropout(0.2),
                nn.Linear(64, n_classes),
            )

        def forward(self, x: Any) -> Any:
            return self.net(x)

    class TemporalBlock(nn.Module):  # type: ignore[misc]
        def __init__(self, cin: int, cout: int, dilation: int) -> None:
            super().__init__()
            pad = 2 * dilation
            self.conv = nn.Sequential(
                nn.ConstantPad1d((pad, 0), 0.0),
                nn.Conv1d(cin, cout, 3, dilation=dilation),
                nn.ReLU(),
                nn.ConstantPad1d((pad, 0), 0.0),
                nn.Conv1d(cout, cout, 3, dilation=dilation),
                nn.ReLU(),
            )
            self.skip = nn.Conv1d(cin, cout, 1) if cin != cout else nn.Identity()

        def forward(self, x: Any) -> Any:
            return torch.relu(self.conv(x) + self.skip(x))

    class TCN(nn.Module):  # type: ignore[misc]
        def __init__(self) -> None:
            super().__init__()
            self.blocks = nn.Sequential(
                TemporalBlock(channels, 32, 1), TemporalBlock(32, 32, 2), TemporalBlock(32, 32, 4), TemporalBlock(32, 32, 8)
            )
            self.head = nn.Linear(32, n_classes)

        def forward(self, x: Any) -> Any:
            return self.head(self.blocks(x).mean(dim=2))

    class GRUNet(nn.Module):  # type: ignore[misc]
        def __init__(self) -> None:
            super().__init__()
            self.gru = nn.GRU(channels, 48, batch_first=True)
            self.head = nn.Linear(48, n_classes)

        def forward(self, x: Any) -> Any:
            out, _ = self.gru(x.transpose(1, 2))
            return self.head(out[:, -1])

    return {"cnn1d": CNN1D, "tcn": TCN, "gru": GRUNet}[name]()


class TorchSequenceClassifier:
    def __init__(self, name: str, n_classes: int, epochs: int = 25, lr: float = 1e-3, batch_size: int = 64, seed: int = 0) -> None:
        self.name, self.n_classes, self.epochs, self.lr, self.batch_size, self.seed = name, n_classes, epochs, lr, batch_size, seed
        self.torch = _torch()

    def _tensor(self, X: NDArray[np.float64]) -> Any:
        x = np.asarray(X, dtype=np.float32).transpose(0, 2, 1)  # (n, 6, size)
        return self.torch.from_numpy((x - self.mean_) / self.std_)

    def fit(self, X: NDArray[np.float64], y: NDArray[np.int64]) -> TorchSequenceClassifier:
        torch = self.torch
        torch.manual_seed(self.seed)
        x = np.asarray(X, dtype=np.float32).transpose(0, 2, 1)
        self.mean_ = x.mean(axis=(0, 2), keepdims=True)
        self.std_ = x.std(axis=(0, 2), keepdims=True) + 1e-6
        self.classes_ = np.unique(y)
        index = {c: i for i, c in enumerate(self.classes_)}
        yt = torch.tensor([index[v] for v in y])
        xt = self._tensor(X)
        self.model_ = _make_network(self.name, len(self.classes_))
        opt = torch.optim.Adam(self.model_.parameters(), lr=self.lr)
        loss_fn = torch.nn.CrossEntropyLoss()
        self.model_.train()
        for _ in range(self.epochs):
            perm = torch.randperm(len(xt))
            for i in range(0, len(xt), self.batch_size):
                b = perm[i : i + self.batch_size]
                opt.zero_grad()
                loss = loss_fn(self.model_(xt[b]), yt[b])
                loss.backward()
                opt.step()
        return self

    def predict_proba(self, X: NDArray[np.float64]) -> NDArray[np.float64]:
        torch = self.torch
        self.model_.eval()
        with torch.no_grad():
            return torch.softmax(self.model_(self._tensor(X)), dim=1).numpy().astype(float)

    def predict(self, X: NDArray[np.float64]) -> NDArray[np.int64]:
        return np.asarray(self.classes_[np.argmax(self.predict_proba(X), axis=1)])


def build_deep_model(name: str, n_classes: int, seed: int = 0) -> TorchSequenceClassifier:
    return TorchSequenceClassifier(name, n_classes=n_classes, seed=seed)
