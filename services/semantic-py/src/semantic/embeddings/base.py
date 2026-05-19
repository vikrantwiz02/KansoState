from abc import ABC, abstractmethod
from typing import Protocol


class Embedder(Protocol):
    """Stateless embedder protocol. Implementations must be thread-safe."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @property
    def model_id(self) -> str:
        ...
