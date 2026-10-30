"""Pass-through stand-in for NVIDIA NeMo text processing.

The real package depends on ``pynini``, which is not published for Windows.
Voxarium installs this shim for models that only import NeMo for optional
number normalization; text is returned unchanged.
"""
