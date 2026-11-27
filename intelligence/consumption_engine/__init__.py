"""Python ports of the deterministic alcohol and pace engines (packages/core), used for
feature generation. Parity with TypeScript and Swift is enforced by shared JSON test vectors."""

from .alcohol import ETHANOL_DENSITY, REGION_GRAMS, ethanol_grams, measure_drink, standard_drinks
from .pace import PaceEvent, pace_snapshot

__all__ = ["ETHANOL_DENSITY", "REGION_GRAMS", "PaceEvent", "ethanol_grams", "measure_drink", "pace_snapshot", "standard_drinks"]
