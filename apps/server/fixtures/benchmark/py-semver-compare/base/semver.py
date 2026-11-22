"""Tiny semantic-version helpers used by the release tooling."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Version:
    major: str
    minor: str
    patch: str
    prerelease: str = ""

    def __str__(self) -> str:
        core = f"{self.major}.{self.minor}.{self.patch}"
        return f"{core}-{self.prerelease}" if self.prerelease else core


def parse(text: str) -> Version:
    """Parse "1.2.3" or "v1.2.3-rc.1"."""
    text = text.strip()
    if text.startswith("v"):
        text = text[1:]
    core, _, prerelease = text.partition("-")
    parts = core.split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise ValueError(f"not a version: {text!r}")
    return Version(parts[0], parts[1], parts[2], prerelease)


def compare(a: str, b: str) -> int:
    """Return -1, 0 or 1 as version a sorts before, equal to, or after version b."""
    va, vb = parse(a), parse(b)
    left = (va.major, va.minor, va.patch)
    right = (vb.major, vb.minor, vb.patch)
    if left != right:
        return -1 if left < right else 1
    if va.prerelease == vb.prerelease:
        return 0
    # A pre-release sorts before the release it leads up to.
    if not va.prerelease:
        return 1
    if not vb.prerelease:
        return -1
    return -1 if va.prerelease < vb.prerelease else 1


def latest(versions: list[str]) -> str:
    """The highest version in the list."""
    best = versions[0]
    for v in versions[1:]:
        if compare(v, best) > 0:
            best = v
    return best
